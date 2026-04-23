// extract-blueprints — analisa as TOP playlists de um gênero (em tiers de seguidores)
// e extrai padrões estruturais reutilizáveis (blueprints) via LLM.
//
// POST { genre_id: string, max_per_tier?: number, force?: boolean } → { ok, blueprints: [...] }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadActiveRules, rulesAsPromptBlock, enforceNamingRules, summarizeRules } from "../_shared/rules.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

// Brackets de seguidores → tier
function tierFor(followers: number): "mega" | "big" | "medium" | "small" {
  if (followers >= 100_000) return "mega";
  if (followers >= 10_000) return "big";
  if (followers >= 1_000) return "medium";
  return "small";
}

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function slugify(s: string) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || `blueprint-${Date.now()}`;
}

async function callLLM(system: string, user: string, schema: any, model = "google/gemini-2.5-flash") {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2500,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{
        type: "function",
        function: {
          name: "extract_blueprints",
          description: "Extract reusable structural blueprints from top playlists.",
          parameters: schema,
        },
      }],
      tool_choice: { type: "function", function: { name: "extract_blueprints" } },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Lovable AI ${resp.status}: ${t.slice(0, 300)}`);
  }
  const j = await resp.json();
  const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("LLM returned no tool_call");
  return JSON.parse(args);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  let body: { genre_id?: string; max_per_tier?: number; force?: boolean };
  try { body = await req.json(); } catch { return jr({ error: "invalid json" }, 400); }
  const genreId = body.genre_id;
  const maxPerTier = Math.min(Math.max(body.max_per_tier ?? 5, 2), 10);
  if (!genreId) return jr({ error: "genre_id required" }, 400);
  if (!LOVABLE_API_KEY) return jr({ error: "LOVABLE_API_KEY not configured" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: genre } = await supabase
    .from("genres").select("id,nome,slug").eq("id", genreId).maybeSingle();
  if (!genre) return jr({ error: "genre not found" }, 404);

  // 🧠 Carrega regras aprendidas pelo Claude (do performance_insights)
  const activeRules = await loadActiveRules(supabase, genreId);
  const rulesBlock = rulesAsPromptBlock(activeRules);
  const rulesSummary = summarizeRules(activeRules);

  // Busca playlists válidas, enriquecidas (com seguidores)
  // owner_type permite priorizar oficiais Spotify (curadoria editorial = tendência)
  const { data: playlists, error: pErr } = await supabase
    .from("search_results")
    .select("id,nome_playlist,descricao,seguidores,total_musicas,spotify_url,imagem_url,quality_score,followers_source,followers_verified_at,owner_id,owner_type")
    .eq("genre_id", genreId)
    .eq("is_valid", true)
    .eq("followers_source", "spotify_api")
    .not("followers_verified_at", "is", null)
    .not("seguidores", "is", null)
    .order("seguidores", { ascending: false })
    .limit(200);
  if (pErr) return jr({ error: pErr.message }, 500);
  if (!playlists || playlists.length === 0) {
    return jr({ ok: false, error: "no enriched playlists available" }, 400);
  }

  // Score híbrido: oficiais Spotify (2.5×) e nomes editoriais (1.2×) sobem no ranking
  // Inerte se owner_type for null (compat com playlists ainda não re-enriquecidas)
  function hybridScore(p: any): number {
    const base = (p.seguidores ?? 0) * ((Number(p.quality_score) || 50) / 100);
    const sourceMult = p.owner_type === "spotify" ? 2.5 : 1.0;
    const editorialBonus = /\b(top|viral|hits|charts|novidades)\b/i.test(p.nome_playlist ?? "") ? 1.2 : 1.0;
    return base * sourceMult * editorialBonus;
  }
  const ranked = [...playlists].sort((a, b) => hybridScore(b) - hybridScore(a));

  // Agrupa por tier e seleciona top N por tier — usando ranked (não a ordem de seguidores pura)
  const byTier: Record<string, any[]> = { mega: [], big: [], medium: [], small: [] };
  for (const p of ranked) {
    const t = tierFor(p.seguidores ?? 0);
    if (byTier[t].length < maxPerTier) byTier[t].push(p);
  }

  // Para cada tier não vazio, pega top tracks das playlists pra dar contexto
  const allIds = Object.values(byTier).flat().map((p: any) => p.id);
  const { data: tracks } = await supabase
    .from("search_tracks")
    .select("result_id,nome_musica,artista,posicao_na_playlist")
    .in("result_id", allIds)
    .order("posicao_na_playlist", { ascending: true })
    .limit(800);
  const tracksByResult: Record<string, any[]> = {};
  for (const t of tracks ?? []) {
    (tracksByResult[t.result_id] ??= []).push(t);
  }

  // Monta payload pro LLM (tier por tier, salvo como blueprints separados)
  const created: any[] = [];
  const updated: any[] = [];

  for (const tier of ["mega", "big", "medium", "small"] as const) {
    const tierPlaylists = byTier[tier];
    if (tierPlaylists.length < 2) continue; // precisa de amostra mínima

    const samplePayload = tierPlaylists.map((p: any) => ({
      id: p.id,
      nome: p.nome_playlist,
      descricao: (p.descricao ?? "").slice(0, 200),
      seguidores: p.seguidores,
      total_musicas: p.total_musicas,
      top_tracks: (tracksByResult[p.id] ?? []).slice(0, 8).map(t => ({ nome: t.nome_musica, artista: t.artista })),
    }));

    const schema = {
      type: "object",
      properties: {
        blueprints: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Nome curto do arquétipo (3-5 palavras)" },
              name_pattern: { type: "string", description: "Padrão de nomenclatura, ex: 'FUNK + ANO + EMOJI'" },
              format: { type: "string", description: "Formato musical (ex: mandelão, romântico)" },
              mood: { type: "string", description: "Atmosfera/vibe" },
              cover_style: {
                type: "object",
                properties: {
                  estilo: { type: "string" },
                  cores: { type: "array", items: { type: "string" } },
                  elementos: { type: "string" },
                },
              },
              track_dna: {
                type: "object",
                properties: {
                  artistas_recorrentes: { type: "array", items: { type: "string" } },
                  caracteristicas: { type: "string" },
                  estilo_curadoria: { type: "string" },
                },
              },
              confidence: { type: "string", enum: ["alta", "media", "baixa"] },
              replication_score: { type: "number", description: "0-100: viabilidade de replicar com sucesso" },
              notes: { type: "string", description: "1-2 frases sobre a oportunidade" },
              source_ids: { type: "array", items: { type: "string" }, description: "IDs das playlists usadas" },
            },
            required: ["name", "name_pattern", "format", "mood", "confidence", "replication_score", "source_ids"],
          },
        },
      },
      required: ["blueprints"],
    };

    let llmOut: any;
    try {
      llmOut = await callLLM(
        `Você é um analista de produto musical. Sua tarefa é extrair PADRÕES ESTRUTURAIS REPLICÁVEIS de playlists de sucesso (gênero: ${genre.nome}, tier ${tier}). Identifique de 1 a 3 arquétipos distintos. Cada blueprint = um modelo replicável de playlist. Seja específico, evite genérico.${rulesBlock}`,
        `Playlists do tier ${tier} (${tierPlaylists.length} amostras):\n${JSON.stringify(samplePayload, null, 2)}\n\nExtraia 1-3 blueprints. Para cada, atribua replication_score 0-100 baseado em: clareza do padrão de nome, distintividade, presença de tracks consistentes, e potencial comercial.\n\nIMPORTANTE: Respeite as REGRAS APRENDIDAS acima — regras 🔴 OBRIGATÓRIO devem aparecer no name_pattern e no formato.`,
        schema,
      );
    } catch (e) {
      console.error(`LLM error tier=${tier}`, (e as Error).message);
      continue;
    }

    const list = Array.isArray(llmOut?.blueprints) ? llmOut.blueprints : [];
    for (const bp of list) {
      const slug = slugify(`${tier}-${bp.name}`);

      // 🔗 PERFORMANCE → REPLICAÇÃO
      // Olha a primeira source_id desse blueprint e busca a performance_class herdada.
      // Se não houver histórico, fallback para classe predominante do gênero (RPC).
      let perfClass: string | null = null;
      const firstSourceId = (bp.source_ids ?? [])[0];
      if (firstSourceId) {
        try {
          const { data: pc } = await supabase.rpc("get_performance_class_for_source", {
            p_source_result_id: firstSourceId,
          });
          if (typeof pc === "string") perfClass = pc;
        } catch (_) { /* segue sem perf */ }
      }
      let priority = "media";
      let reason = "sem histórico de performance — prioridade padrão";
      try {
        const { data: pr } = await supabase.rpc("priority_from_performance", { p_class: perfClass });
        if (Array.isArray(pr) && pr[0]) {
          priority = pr[0].priority ?? "media";
          reason = pr[0].reason ?? reason;
        }
      } catch (_) { /* fallback default */ }

      // 🧠 Aplica regras de naming determinísticas (ano, subgênero, prefix/suffix, avoid)
      const enforcedName = enforceNamingRules(String(bp.name), activeRules);

      const row = {
        genre_id: genreId,
        tier,
        name: enforcedName.slice(0, 120),
        slug,
        name_pattern: bp.name_pattern ?? null,
        format: bp.format ?? null,
        mood: bp.mood ?? null,
        cover_style: bp.cover_style ?? {},
        track_dna: bp.track_dna ?? {},
        source_playlists: tierPlaylists
          .filter((p: any) => (bp.source_ids ?? []).includes(p.id))
          .map((p: any) => ({
            id: p.id, nome: p.nome_playlist, url: p.spotify_url,
            seguidores: p.seguidores, imagem: p.imagem_url,
          })),
        sample_size: tierPlaylists.length,
        confidence: ["alta", "media", "baixa"].includes(bp.confidence) ? bp.confidence : "media",
        notes: bp.notes ?? null,
        replication_score: Math.max(0, Math.min(100, Number(bp.replication_score ?? 0))),
        status: "active",
        generated_by_model: "google/gemini-2.5-flash",
        performance_source: perfClass,
        replication_priority: priority,
        replication_reason: reason,
      };

      const { data: existing } = await supabase
        .from("playlist_blueprints").select("id").eq("genre_id", genreId).eq("slug", slug).maybeSingle();
      if (existing && !body.force) {
        const { error } = await supabase.from("playlist_blueprints")
          .update({ ...row, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (!error) updated.push({ id: existing.id, name: row.name, tier });
      } else if (existing && body.force) {
        const { error } = await supabase.from("playlist_blueprints")
          .update({ ...row, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (!error) updated.push({ id: existing.id, name: row.name, tier });
      } else {
        const { data: ins, error } = await supabase.from("playlist_blueprints")
          .insert(row).select("id,name,tier").single();
        if (!error && ins) created.push(ins);
      }
    }
  }

  await supabase.from("collection_logs").insert({
    genre_id: genreId, acao: "extract-blueprints", status: "sucesso",
    mensagem: `Extraídos ${created.length} novos blueprints, ${updated.length} atualizados`,
  }).then(() => {}, () => {});

  return jr({
    ok: true,
    genre: { id: genre.id, nome: genre.nome, slug: genre.slug },
    created, updated,
    total: created.length + updated.length,
  });
});
