// generate-templates — gera N variações de playlist a partir de um blueprint.
// POST { blueprint_id: string, count?: number } → { ok, templates: [...] }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadActiveRules, rulesAsPromptBlock, enforceNamingRules, reorderTracksByRules, summarizeRules } from "../_shared/rules.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function tryExtractJson(text: string): any | null {
  if (!text) return null;
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.search(/[\{\[]/);
  if (start === -1) return null;
  const openChar = cleaned[start];
  const closeChar = openChar === "[" ? "]" : "}";
  const end = cleaned.lastIndexOf(closeChar);
  if (end === -1 || end < start) return null;
  cleaned = cleaned.substring(start, end + 1);
  try { return JSON.parse(cleaned); } catch {}
  try {
    const fixed = cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/[\x00-\x1F\x7F]/g, "");
    return JSON.parse(fixed);
  } catch { return null; }
}

async function callLLMOnce(system: string, user: string, schema: any, model: string) {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{
        type: "function",
        function: {
          name: "generate_templates",
          description: "Generate playlist template variations from a blueprint.",
          parameters: schema,
        },
      }],
      tool_choice: { type: "function", function: { name: "generate_templates" } },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Lovable AI ${resp.status}: ${t.slice(0, 300)}`);
  }
  const j = await resp.json();
  const msg = j?.choices?.[0]?.message;
  const args = msg?.tool_calls?.[0]?.function?.arguments;
  if (args) {
    try { return JSON.parse(args); } catch { /* fallthrough */ }
  }
  // Fallback: alguns modelos devolvem JSON em content quando deveriam usar tool_call
  const fromContent = tryExtractJson(typeof msg?.content === "string" ? msg.content : "");
  if (fromContent) return fromContent;
  const finish = j?.choices?.[0]?.finish_reason;
  throw new Error(`LLM returned no tool_call (finish=${finish ?? "?"}, model=${model})`);
}

// Fallback seletivo C.4:
//   • 429 (rate limit) ou 402 (sem créditos) → backoff e RETENTA o mesmo modelo (não troca)
//   • 5xx, network, timeout → troca pra modelo "pro" (mais caro mas mais robusto)
//   • Outros 4xx (400 schema, 401 auth) → falha imediato, não adianta trocar
async function callLLM(system: string, user: string, schema: any) {
  const flash = "google/gemini-2.5-flash";
  const pro = "google/gemini-2.5-pro";
  let lastErr: unknown;

  // Tentativa 1: flash
  try {
    return await callLLMOnce(system, user, schema, flash);
  } catch (e) {
    lastErr = e;
    const msg = (e as Error).message ?? "";
    const m = msg.match(/HTTP (\d{3})/);
    const status = m ? Number(m[1]) : null;

    // 429/402 → backoff e retenta MESMO modelo (rate limit/quota não some trocando)
    if (status === 429 || status === 402) {
      console.warn(`[generate-templates] ${status} no flash — backoff 3s e retentando flash`);
      await new Promise((r) => setTimeout(r, 3000));
      try { return await callLLMOnce(system, user, schema, flash); }
      catch (e2) { lastErr = e2; throw lastErr; }
    }

    // 4xx (não-429/402) → falha imediato; trocar de modelo não resolve
    if (status !== null && status >= 400 && status < 500) {
      console.warn(`[generate-templates] ${status} no flash — fatal, sem fallback`);
      throw lastErr;
    }

    // 5xx, timeout, network → fallback pro modelo pro
    console.warn(`[generate-templates] flash falhou (${msg.slice(0, 80)}) — fallback pra pro`);
    try { return await callLLMOnce(system, user, schema, pro); }
    catch (e2) { lastErr = e2; throw lastErr; }
  }
}

Deno.serve(async (req) => {
  const __dep = await deprecationGate(req, "generate-templates");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  // 🔐 Exige service_role (chamada interna) ou usuário admin/curador
  const { requireTeamAccess } = await import("../_shared/auth.ts");
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: { blueprint_id?: string; count?: number };
  try { body = await req.json(); } catch { return jr({ error: "invalid json" }, 400); }
  const blueprintId = body.blueprint_id;
  const count = Math.min(Math.max(body.count ?? 5, 1), 10);
  if (!blueprintId) return jr({ error: "blueprint_id required" }, 400);
  if (!LOVABLE_API_KEY) return jr({ error: "LOVABLE_API_KEY not configured" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: bp, error: bpErr } = await supabase
    .from("playlist_blueprints").select("*").eq("id", blueprintId).maybeSingle();
  if (bpErr || !bp) return jr({ error: "blueprint not found" }, 404);

  const { data: genre } = await supabase
    .from("genres").select("id,nome,slug").eq("id", bp.genre_id).maybeSingle();

  // 🎯 Target de faixas — replicação deve manter aparência natural:
  //   • Se houver playlists base no blueprint: média ±20% (faixa min/max).
  //   • Caso contrário: 40–60 faixas (default seguro do gênero).
  // O cap final no Spotify continua 100 (em create-spotify-playlist),
  // mas o LLM precisa gerar o suficiente pra honrar o target.
  function computeTrackTarget(sources: any[]): { min: number; max: number; ideal: number; basis: string } {
    const counts = (Array.isArray(sources) ? sources : [])
      .map((p) => Number(p?.total_musicas ?? p?.total_tracks ?? 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (counts.length === 0) {
      return { min: 40, max: 60, ideal: 50, basis: "default (sem playlist base)" };
    }
    const avg = counts.reduce((s, n) => s + n, 0) / counts.length;
    const min = Math.max(25, Math.round(avg * 0.8));
    const max = Math.max(min + 5, Math.round(avg * 1.2));
    const ideal = Math.round(avg);
    return { min, max, ideal, basis: `média de ${counts.length} playlist(s) base = ${ideal}` };
  }
  const trackTarget = computeTrackTarget(bp.source_playlists ?? []);

  // 🧠 Carrega regras aprendidas (Claude → executor)
  const activeRules = await loadActiveRules(supabase, bp.genre_id);
  const rulesBlock = rulesAsPromptBlock(activeRules);
  const rulesSummary = summarizeRules(activeRules);

  // 🆕 TTL DO MODELO (24h) — alinhado com ANALYZE_CACHE_MS do genre-autopilot.
  // Se ultima_analise está stale ou modelo nem existe, renova on-demand chamando
  // analyze-genre antes de gerar. Evita templates baseados em modelo antigo/vazio
  // sem quebrar o fluxo (auto-cura ao invés de throw).
  const MODEL_TTL_MS = 24 * 60 * 60 * 1000;
  const { data: modelMeta } = await supabase
    .from("genre_models")
    .select("ultima_analise")
    .eq("genre_id", bp.genre_id)
    .maybeSingle();

  const modelAge = modelMeta?.ultima_analise
    ? Date.now() - new Date(modelMeta.ultima_analise).getTime()
    : Number.POSITIVE_INFINITY;

  if (modelAge > MODEL_TTL_MS) {
    const reason = modelMeta?.ultima_analise
      ? `modelo stale (${Math.round(modelAge / 3600000)}h > 24h)`
      : "modelo nunca analisado";
    console.log(`[generate-templates] Auto-renovando genre_models — ${reason}`);
    try {
      const refreshResp = await fetch(`${SUPABASE_URL}/functions/v1/analyze-genre`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ genre_id: bp.genre_id }),
      });
      if (!refreshResp.ok) {
        const txt = await refreshResp.text();
        return jr({
          error: `Não foi possível renovar genre_models (${reason}): analyze-genre HTTP ${refreshResp.status} — ${txt.slice(0, 200)}`,
        }, 503);
      }
    } catch (e) {
      return jr({
        error: `Falha ao renovar genre_models (${reason}): ${e instanceof Error ? e.message : String(e)}`,
      }, 503);
    }
  }

  // Faixas recorrentes do gênero como pool — pool grande pra LLM montar 40-60 faixas naturais.
  // (Re-leitura após possível auto-renovação acima.)
  const { data: model } = await supabase
    .from("genre_models").select("musicas_recorrentes,palavras_chave")
    .eq("genre_id", bp.genre_id).maybeSingle();
  const trackSeedsRaw = (model?.musicas_recorrentes ?? []).slice(0, 200);
  // Garante pool ≥ trackTarget.max + folga; se faltar, mantém o que tem (LLM repete com cuidado).
  const trackSeeds = reorderTracksByRules(trackSeedsRaw, activeRules).slice(0, Math.max(120, trackTarget.max + 30));
  const allKeywords = (model?.palavras_chave ?? []).slice(0, 30);

  // 🔁 ANTI-REPETIÇÃO: nomes recentes do gênero (últimos 30d) → anti-exemplos no prompt + dedup pós-LLM.
  // Resolve "MODÃO RAIZ 2024 - SÓ AS MELHORES 🎉" aparecendo 3x no mesmo dia.
  const { data: recentTpls } = await supabase
    .from("playlist_templates")
    .select("name")
    .eq("genre_id", bp.genre_id)
    .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .not("status", "eq", "archived")
    .order("created_at", { ascending: false })
    .limit(40);
  const recentNames: string[] = (recentTpls ?? []).map((r) => String(r.name ?? "")).filter(Boolean);
  // Normalização canônica para comparação (lowercase, sem emoji, sem pontuação, espaços colapsados)
  const normalizeName = (s: string) =>
    s.toLowerCase()
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const recentCanonSet = new Set(recentNames.map(normalizeName));

  // Já existem templates? quantos? (usa para variation_index)
  const { count: existingCount } = await supabase
    .from("playlist_templates").select("*", { count: "exact", head: true }).eq("blueprint_id", blueprintId);
  const startIdx = existingCount ?? 0;

  const schema = {
    type: "object",
    properties: {
      templates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Nome final pronto pro Spotify (3-6 palavras, máx 1 emoji)" },
            description: { type: "string", description: "Descrição Spotify (≤150 chars)" },
            cover_brief: { type: "string", description: "Briefing 1 frase pra capa, baseado no cover_style" },
            keywords: { type: "array", items: { type: "string" }, description: "5-8 keywords da playlist" },
            track_seeds: {
              type: "array",
              minItems: trackTarget.min,
              maxItems: trackTarget.max,
              items: {
                type: "object",
                properties: {
                  nome: { type: "string" },
                  artista: { type: "string" },
                },
                required: ["nome", "artista"],
              },
              description: `Entre ${trackTarget.min} e ${trackTarget.max} faixas (ideal ≈ ${trackTarget.ideal}). Aparência natural e competitiva. Selecionadas do track_pool, sem duplicatas.`,
            },
            regras: {
              type: "object",
              properties: {
                obrigatorio: { type: "array", items: { type: "string" } },
                evitar: { type: "array", items: { type: "string" } },
              },
            },
            replication_score: { type: "number", description: "0-100 confiança de que esta variação vai performar" },
          },
          required: ["name", "description", "cover_brief", "keywords", "track_seeds", "replication_score"],
        },
      },
    },
    required: ["templates"],
  };

  const userPayload = {
    genero: genre?.nome,
    blueprint: {
      name: bp.name,
      tier: bp.tier,
      name_pattern: bp.name_pattern,
      format: bp.format,
      mood: bp.mood,
      cover_style: bp.cover_style,
      track_dna: bp.track_dna,
      source_playlists: (bp.source_playlists ?? []).slice(0, 5).map((p: any) => p.nome),
    },
    track_pool: trackSeeds,
    keyword_pool: allKeywords,
    quantidade: count,
    track_target: trackTarget,
    nomes_recentes_ja_usados: recentNames.slice(0, 25),
  };

  const antiRepeatBlock = recentNames.length > 0
    ? `\n\n🚫 ANTI-REPETIÇÃO — OBRIGATÓRIO:\nNão repita NENHUM destes nomes (ou variações próximas) que já existem no gênero nos últimos 30 dias:\n${recentNames.slice(0, 25).map((n) => `  • ${n}`).join("\n")}\n\nVarie estrutura, ângulo, sub-tema, sentimento, ocasião — NÃO use o mesmo template de nome.`
    : "";

  let llmOut: any;
  try {
    llmOut = await callLLM(
      `Você é um diretor criativo de playlists. Gere variações DISTINTAS de uma playlist seguindo o blueprint fornecido. Mantenha a essência (formato, mood, padrão de nome) mas varie ângulo/sub-tema. Use apenas faixas e keywords do pool. Resposta SEMPRE em português BR.${rulesBlock}${antiRepeatBlock}`,
      `Gere ${count} variações para este blueprint:\n${JSON.stringify(userPayload, null, 2)}\n\nCada variação deve ser comercial, replicável e fiel ao blueprint. Atribua replication_score 0-100 baseado em força do nome, encaixe com o blueprint, e potencial.\n\n🎯 QUANTIDADE DE FAIXAS — OBRIGATÓRIO:\n• Cada variação DEVE ter entre ${trackTarget.min} e ${trackTarget.max} faixas (ideal ≈ ${trackTarget.ideal}).\n• Base do alvo: ${trackTarget.basis}.\n• Selecione faixas variadas do track_pool, sem duplicar nome+artista dentro da mesma variação.\n• Aparência natural e competitiva no algoritmo do Spotify — playlist curta demais perde no ranking.\n\nIMPORTANTE: Cumpra TODAS as REGRAS APRENDIDAS acima. Regras 🔴 OBRIGATÓRIO devem aparecer no name e nas regras.obrigatorio.${antiRepeatBlock ? "\n\n⚠️ Se gerar nome igual/similar a algum em nomes_recentes_ja_usados, a variação será DESCARTADA pelo sistema." : ""}`,
      schema,
    );
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }

  const list = Array.isArray(llmOut?.templates) ? llmOut.templates : [];

  // 🎯 Enriquece track_seeds com spotify_track_id quando disponível em search_tracks.
  // Lookup case-insensitive por (nome, artista) — evita N searches no Spotify depois.
  const allSeeds: Array<{ nome: string; artista: string }> = [];
  for (const t of list) {
    const seeds = Array.isArray(t.track_seeds) ? t.track_seeds : [];
    for (const s of seeds) {
      const nome = String(s?.nome ?? "").trim();
      const artista = String(s?.artista ?? "").trim();
      if (nome && artista) allSeeds.push({ nome, artista });
    }
  }
  const seedIdMap = new Map<string, string>(); // key = `${nome}|${artista}` lower
  if (allSeeds.length > 0) {
    const { data: matches } = await supabase
      .from("search_tracks")
      .select("nome_musica,artista,spotify_track_id")
      .eq("genre_id", bp.genre_id)
      .not("spotify_track_id", "is", null)
      .limit(5000);
    if (matches) {
      for (const m of matches) {
        const k = `${(m.nome_musica ?? "").toLowerCase().trim()}|${(m.artista ?? "").toLowerCase().trim()}`;
        if (!seedIdMap.has(k)) seedIdMap.set(k, m.spotify_track_id);
      }
    }
  }

  // 🎯 Fallback: faixas sem ID após lookup → busca no Spotify (1 req/faixa única).
  // Garante 100% coverage e evita "remix errado" no momento da publicação.
  const missing = new Set<string>();
  for (const t of list) {
    const seeds = Array.isArray(t.track_seeds) ? t.track_seeds : [];
    for (const s of seeds) {
      const nome = String(s?.nome ?? "").trim();
      const artista = String(s?.artista ?? "").trim();
      if (!nome || !artista) continue;
      const k = `${nome.toLowerCase()}|${artista.toLowerCase()}`;
      if (!seedIdMap.has(k)) missing.add(k);
    }
  }
  if (missing.size > 0) {
    try {
      // =====================================================================
      // EXCEÇÃO DOCUMENTADA — `/v1/search` (Fase 17-C, Onda 4)
      // ---------------------------------------------------------------------
      // Fallback de resolução nome+artista → spotify_track_id. Usa o pool CC
      // do catalog-gateway via `/v1/search` porque:
      //   - o Observer (VPS) não expõe busca textual (sem URL pública
      //     canônica para scrape);
      //   - o cache local (`spotify_track_cache`) é indexado por id, não
      //     por (nome, artista), então não resolve nomes que nunca foram
      //     enfileirados pelo worker.
      // Remoção condicionada à VPS expor `/search` no contrato Observer
      // (mesma condição do `run-search`). Throttle 300ms entre buscas e
      // cap rígido de 200 termos por execução.
      // =====================================================================
      const { ccFetch } = await import("../_shared/catalog-gateway.ts"); // exceção /search
      const items = Array.from(missing).slice(0, 200); // hard cap
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      for (let idx = 0; idx < items.length; idx++) {
        if (idx > 0) await sleep(300); // throttle entre buscas
        const k = items[idx];
        const [nome, artista] = k.split("|");
        try {
          const q = `track:${nome} artist:${artista}`;
          const r = await ccFetch(
            `https://api.spotify.com/v1/search?type=track&limit=1&q=${encodeURIComponent(q)}`,
            "generate-templates",
          );
          if (!r.ok) continue;
          const j = await r.json();
          const id = j?.tracks?.items?.[0]?.id;
          if (id) seedIdMap.set(k, id);
        } catch { /* skip */ }
      }
    } catch (e) {
      console.warn("[generate-templates] spotify fallback failed:", (e as Error).message);
    }
  }

  const rows = list.map((t: any, i: number) => {
    // Dedup por nome|artista (case-insensitive)
    const seen = new Set<string>();
    let enrichedSeeds = (Array.isArray(t.track_seeds) ? t.track_seeds : [])
      .map((s: any) => {
        const nome = String(s?.nome ?? "").trim();
        const artista = String(s?.artista ?? "").trim();
        return { nome, artista };
      })
      .filter((s) => {
        if (!s.nome || !s.artista) return false;
        const k = `${s.nome.toLowerCase()}|${s.artista.toLowerCase()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

    // 🛡️ Safety net: se LLM devolveu menos que o mínimo, completa com pool ordenado.
    if (enrichedSeeds.length < trackTarget.min) {
      for (const cand of trackSeeds) {
        if (enrichedSeeds.length >= trackTarget.ideal) break;
        const nome = String(cand?.nome ?? cand?.nome_musica ?? "").trim();
        const artista = String(cand?.artista ?? "").trim();
        if (!nome || !artista) continue;
        const k = `${nome.toLowerCase()}|${artista.toLowerCase()}`;
        if (seen.has(k)) continue;
        seen.add(k);
        enrichedSeeds.push({ nome, artista });
      }
    }
    // 🛡️ Cap superior — nunca passa do max, mantém aparência natural.
    if (enrichedSeeds.length > trackTarget.max) {
      enrichedSeeds = enrichedSeeds.slice(0, trackTarget.max);
    }

    // Anexa spotify_track_id quando temos
    const seedsWithIds = enrichedSeeds.map((s) => {
      const k = `${s.nome.toLowerCase()}|${s.artista.toLowerCase()}`;
      return { nome: s.nome, artista: s.artista, spotify_track_id: seedIdMap.get(k) ?? null };
    });

    // 🧠 Aplica regras determinísticas (Claude → execução)
    const enforcedName = enforceNamingRules(String(t.name), activeRules).slice(0, 200);
    return {
      blueprint_id: blueprintId,
      genre_id: bp.genre_id,
      variation_index: startIdx + i,
      name: enforcedName,
      description: t.description ?? null,
      cover_brief: t.cover_brief ?? null,
      track_seeds: reorderTracksByRules(seedsWithIds, activeRules),
      keywords: t.keywords ?? [],
      regras: t.regras ?? {},
      replication_score: Math.max(0, Math.min(100, Number(t.replication_score ?? 0))),
      status: "pending",
      generated_by_model: "google/gemini-2.5-flash",
    };
  });

  // 🚫 DEDUP FINAL: descarta linhas cujo nome canônico já existe nos últimos 30d
  // OU duplicado dentro do próprio batch atual.
  const batchSeen = new Set<string>();
  const dedupedRows: any[] = [];
  let droppedDuplicates = 0;
  for (const row of rows) {
    const canon = normalizeName(String(row.name ?? ""));
    if (!canon) { droppedDuplicates++; continue; }
    if (recentCanonSet.has(canon) || batchSeen.has(canon)) {
      droppedDuplicates++;
      continue;
    }
    batchSeen.add(canon);
    dedupedRows.push(row);
  }
  if (droppedDuplicates > 0) {
    console.log(`[generate-templates] anti-repetição descartou ${droppedDuplicates}/${rows.length} templates duplicados`);
  }

  if (dedupedRows.length === 0) {
    return jr({
      ok: false,
      error: `Todos os ${rows.length} nomes gerados pela IA já existem nos últimos 30 dias — anti-repetição bloqueou todos. Tente novamente.`,
      dropped_names: rows.map((r) => r.name),
    }, 422);
  }

  const { data: inserted, error: insErr } = await supabase
    .from("playlist_templates").insert(dedupedRows).select("id,name,replication_score,variation_index");
  if (insErr) return jr({ error: insErr.message }, 500);

  await supabase.from("collection_logs").insert({
    genre_id: bp.genre_id, acao: "generate-templates", status: "sucesso",
    mensagem: `${inserted?.length ?? 0} templates gerados a partir do blueprint "${bp.name}" (regras: ${rulesSummary.total}, alta=${rulesSummary.high}${droppedDuplicates > 0 ? `, dedup=${droppedDuplicates}` : ""})`,
  }).then(() => {}, (e) => console.error("[generate-templates] log/op failed:", e?.message ?? e));

  // 🎯 Dispara scoring automático dos templates recém-criados.
  // O score-templates classifica em hot/medium/weak, arquiva os fracos
  // e dispara generate-cover-variations pros hot. Tudo em background.
  const newIds = (inserted ?? []).map((r: any) => r.id);
  if (newIds.length > 0) {
    fetch(`${SUPABASE_URL}/functions/v1/score-templates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ template_ids: newIds }),
    }).catch((e) => console.warn("[generate-templates] score trigger failed:", e.message));
  }

  return jr({
    ok: true,
    blueprint_id: blueprintId,
    templates: inserted ?? [],
    count: inserted?.length ?? 0,
    rules_applied: rulesSummary,
    scoring_triggered: newIds.length > 0,
  });
});
