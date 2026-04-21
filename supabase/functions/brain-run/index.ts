// brain-run — orquestra pipeline em BACKGROUND para evitar timeout (150s).
// POST { slug, intensity?, max_playlists? }            → { ok, job_id }
// POST { action: "resume", slug }                       → { ok, job_id }  (continua enrich + análise)
// GET  ?job_id=...                                     → { ok, status, stage, progress, result?, stale? }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Intensity = "leve" | "normal" | "agressivo";

interface StartBody {
  slug: string;
  intensity?: Intensity;
  max_playlists?: 20 | 50 | 100;
  action?: "start" | "resume";
  survival_mode?: boolean;
}

const KITS: Record<string, string[]> = {
  funk: [
    "funk", "funk br", "funk brasil", "funk mandelão", "funk consciente",
    "funk putaria", "funk remix", "funk viral", "funk tiktok", "funk sp", "funk carioca",
  ],
  sertanejo: [
    "sertanejo", "sertanejo universitário", "sertanejo raiz", "sertanejo sofrência",
    "sertanejo 2025", "sertanejo viral", "sertanejo tiktok", "modão sertanejo",
    "feminejo", "sertanejo agro", "sertanejo balada",
  ],
  piseiro: [
    "piseiro", "piseiro 2025", "piseiro viral", "piseiro tiktok", "piseiro nordeste",
    "piseiro romântico", "piseiro arrochado", "piseiro vaquejada",
    "barraco piseiro", "piseiro sofrência", "piseiro top",
  ],
};

function intensityLimits(intensity: Intensity) {
  switch (intensity) {
    // delayMs = pausa entre BATCHES de buscas paralelas (não entre cada termo)
    case "leve":      return { termsCount: 5,  delayMs: 1000, batchSize: 2 };
    case "agressivo": return { termsCount: 12, delayMs: 300,  batchSize: 4 };
    default:          return { termsCount: 8,  delayMs: 500,  batchSize: 3 };
  }
}

function jr(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callFn(name: string, body: unknown) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  try { return { ok: r.ok, data: JSON.parse(txt), status: r.status }; }
  catch { return { ok: r.ok, data: { raw: txt }, status: r.status }; }
}

// Garante que o briefing seja gerado SEMPRE que existir um genre_model.
// Tenta até 2x. Não lança — apenas loga em stages e collection_logs.
async function ensureBriefing(supabase: any, gid: string, stages: Record<string, unknown>, opts?: { survival_mode?: boolean }) {
  // Pré-condição: precisa existir genre_models pro briefing rodar
  const { data: model } = await supabase
    .from("genre_models").select("id").eq("genre_id", gid).maybeSingle();
  if (!model) {
    stages.briefing = { ok: false, skipped: true, reason: "sem genre_model" };
    await supabase.from("collection_logs").insert({
      genre_id: gid, acao: "generate-briefing", status: "erro",
      mensagem: "Briefing pulado: genre_model inexistente",
    }).catch(() => {});
    return;
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const br = await callFn("generate-playlists-briefing", {
        genre_id: gid,
        survival_mode: opts?.survival_mode === true,
      });
      const d = br.data as any;
      if (br.ok && d?.ok) {
        stages.briefing = { ok: true, version: d.version, count: d.count, attempt, survival_mode: opts?.survival_mode === true };
        return;
      }
      stages.briefing = { ok: false, attempt, error: d?.error ?? `HTTP ${br.status}` };
      if (attempt === 2) {
        await supabase.from("collection_logs").insert({
          genre_id: gid, acao: "generate-briefing", status: "erro",
          mensagem: `Briefing falhou após 2 tentativas: ${(d?.error ?? `HTTP ${br.status}`).toString().slice(0, 400)}`,
        }).catch(() => {});
      }
    } catch (e) {
      stages.briefing = { ok: false, attempt, error: (e as Error).message };
      if (attempt === 2) {
        await supabase.from("collection_logs").insert({
          genre_id: gid, acao: "generate-briefing", status: "erro",
          mensagem: `Briefing exception: ${(e as Error).message.slice(0, 400)}`,
        }).catch(() => {});
      }
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 1500));
  }
}

// ---------- Job state via collection_logs ----------
// acao = `brain-job:${jobId}`, mensagem = JSON {status, stage, progress, result?, error?}
async function setJob(
  supabase: any,
  genreId: string,
  jobId: string,
  payload: { status: "running" | "done" | "error"; stage: string; progress: number; result?: unknown; error?: string },
) {
  await supabase.from("collection_logs").insert({
    genre_id: genreId,
    acao: `brain-job:${jobId}`,
    status: payload.status === "error" ? "erro" : "sucesso",
    mensagem: JSON.stringify(payload).slice(0, 8000),
  });
}

async function getJob(supabase: any, jobId: string) {
  const { data } = await supabase
    .from("collection_logs")
    .select("mensagem,created_at,genre_id")
    .eq("acao", `brain-job:${jobId}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  try { return { ...JSON.parse(data.mensagem), genre_id: data.genre_id, updated_at: data.created_at }; }
  catch { return null; }
}

// ---------- Pipeline em background ----------
async function runPipeline(jobId: string, body: StartBody) {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const slug = body.slug.toLowerCase();
  const kit = KITS[slug] ?? null; // boost opcional para gêneros conhecidos
  const { termsCount, delayMs, batchSize } = intensityLimits(body.intensity ?? "normal");
  const maxPerSearch = body.max_playlists ?? 50;
  const survivalMode = body.survival_mode === true;
  const start = Date.now();

  const { data: genre } = await supabase
    .from("genres").select("id,nome,slug").eq("slug", slug).maybeSingle();
  if (!genre) {
    // Não temos genreId — guarda erro num log órfão
    await supabase.from("collection_logs").insert({
      acao: `brain-job:${jobId}`, status: "erro",
      mensagem: JSON.stringify({ status: "error", stage: "init", progress: 0, error: `Gênero '${slug}' não encontrado no banco. Crie em /genres antes.` }),
    });
    return;
  }
  const gid = genre.id;
  await setJob(supabase, gid, jobId, {
    status: "running",
    stage: survivalMode ? "⚠️ Modo sobrevivência — usando dados existentes" : "Gerando termos...",
    progress: 5,
  });

  const stages: Record<string, unknown> = {};
  if (survivalMode) (stages as any).survival_mode = true;

  try {
    // 🛟 SURVIVAL MODE: pula coleta, usa cache + IA
    if (survivalMode) {
      // 1) Cache: 7 dias, top 150 por priority_score; fallback 100 sem filtro de data
      let { data: cached } = await supabase
        .from("search_results")
        .select("id,seguidores")
        .eq("genre_id", gid)
        .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order("priority_score", { ascending: false, nullsFirst: false })
        .limit(150);
      let dataSource: "cache_7d" | "cache_full" = "cache_7d";
      if (!cached || cached.length === 0) {
        const fb = await supabase
          .from("search_results")
          .select("id,seguidores")
          .eq("genre_id", gid)
          .order("priority_score", { ascending: false, nullsFirst: false })
          .limit(100);
        cached = fb.data ?? [];
        dataSource = "cache_full";
      }
      stages.survival_cache = { source: dataSource, total: cached.length };

      // 2) Enrich inteligente: só followers IS NULL, limite 20, ignora se falhar
      const pendingIds = (cached ?? []).filter((r: any) => r.seguidores == null).slice(0, 20).map((r: any) => r.id);
      if (pendingIds.length > 0) {
        await setJob(supabase, gid, jobId, {
          status: "running",
          stage: `⚠️ Modo sobrevivência — enriquecendo ${pendingIds.length} pendentes...`,
          progress: 35,
        });
        try {
          const er = await callFn("enrich-playlists", {
            genre_id: gid, limit: 20, fetch_tracks: true, result_ids: pendingIds,
          });
          const ed = er.data as any;
          stages.survival_enrich = { ok: er.ok && ed?.ok, enriched: ed?.enriched ?? 0, tracks_saved: ed?.tracks_saved ?? 0 };
        } catch (e) {
          stages.survival_enrich = { ok: false, ignored: true, error: (e as Error).message };
        }
      } else {
        stages.survival_enrich = { ok: true, skipped: true, reason: "nada pendente" };
      }

      // 3) Analyze normal
      await setJob(supabase, gid, jobId, {
        status: "running",
        stage: "⚠️ Modo sobrevivência — analisando padrões...",
        progress: 60,
      });
      try {
        const a = await callFn("analyze-genre", { genre_id: gid });
        stages.analyze = (a.data as any)?.insights ?? { ok: a.ok };
      } catch (e) {
        stages.analyze = { ok: false, error: (e as Error).message };
      }

      // 4) Briefing SEMPRE (com survival_mode → filtros relaxados + metadata)
      await setJob(supabase, gid, jobId, {
        status: "running",
        stage: "⚠️ Modo sobrevivência — gerando briefing...",
        progress: 90,
      });
      await ensureBriefing(supabase, gid, stages, { survival_mode: true });

      // Sincroniza contadores
      const [pCnt, tCnt, teCnt] = await Promise.all([
        supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", gid),
        supabase.from("search_tracks").select("*", { count: "exact", head: true }).eq("genre_id", gid),
        supabase.from("search_terms").select("*", { count: "exact", head: true }).eq("genre_id", gid),
      ]);
      await supabase.from("genres").update({
        total_playlists: pCnt.count ?? 0,
        total_musicas: tCnt.count ?? 0,
        total_termos: teCnt.count ?? 0,
        ultima_coleta: new Date().toISOString(),
        status: "parcial",
      }).eq("id", gid);

      await supabase.from("collection_logs").insert({
        genre_id: gid, acao: "survival-mode", status: "ok",
        mensagem: "Pipeline executado sem coleta nova (Apify bloqueado)",
        duracao_ms: Date.now() - start,
      });

      const { data: model } = await supabase
        .from("genre_models").select("*").eq("genre_id", gid).maybeSingle();

      await setJob(supabase, gid, jobId, {
        status: "done",
        stage: "⚠️ Modo sobrevivência — concluído com dados existentes",
        progress: 100,
        result: {
          ok: true, survival_mode: true, apify_blocked: true,
          data_freshness: "stale", data_source: dataSource,
          genre: { id: gid, nome: genre.nome, slug: genre.slug },
          duration_ms: Date.now() - start,
          stages, model: model ?? null,
        },
      });
      return;
    }

    // 🟢 OTIMIZAÇÃO 1: CACHE-SKIP — se já temos ≥30 playlists relevantes coletadas
    //    nos últimos 7 dias, pula a coleta Apify inteira e vai direto pra enrich+análise+briefing.
    const CACHE_THRESHOLD = 30;
    const CACHE_WINDOW_DAYS = 7;
    const cacheSince = new Date(Date.now() - CACHE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { count: freshCount } = await supabase
      .from("search_results")
      .select("*", { count: "exact", head: true })
      .eq("genre_id", gid)
      .gte("last_seen_at", cacheSince);
    const cacheHit = (freshCount ?? 0) >= CACHE_THRESHOLD;

    // 1) Termos — fonte dinâmica:
    //    a) Se há KIT específico (funk/sertanejo/piseiro) → usa kit (curado, melhor qualidade)
    //    b) Senão → garante que generate-terms rodou (cria variações automáticas) e usa search_terms do gênero
    let selectedTerms: string[] = [];
    if (kit && kit.length > 0) {
      selectedTerms = kit.slice(0, termsCount);
      const { data: existingTerms } = await supabase
        .from("search_terms").select("id,termo").eq("genre_id", gid);
      const existingMap = new Map((existingTerms ?? []).map((t: any) => [t.termo.toLowerCase(), t.id]));
      const missing = selectedTerms.filter(t => !existingMap.has(t.toLowerCase()));
      if (missing.length > 0) {
        await supabase.from("search_terms").insert(
          missing.map(t => ({ genre_id: gid, termo: t, tipo: "kit" })),
        );
      }
    } else {
      // Sem kit → dispara generate-terms se ainda não houver termos suficientes
      const { count: existingCount } = await supabase
        .from("search_terms").select("*", { count: "exact", head: true }).eq("genre_id", gid);
      if ((existingCount ?? 0) < termsCount) {
        const gt = await callFn("generate-terms", { genre_id: gid });
        if (!gt.ok || !(gt.data as any)?.ok) {
          await supabase.from("collection_logs").insert({
            genre_id: gid, acao: "brain-run", status: "erro",
            mensagem: `generate-terms falhou: ${(gt.data as any)?.error ?? `HTTP ${gt.status}`}`,
          }).catch(() => {});
        }
      }
      // Seleciona top N termos priorizando: completo > variacao > contextual > prefixo
      // 🟢 OTIMIZAÇÃO 2: também descarta termos comprovadamente fracos (executados c/ 0 resultados)
      const { data: allDyn } = await supabase
        .from("search_terms").select("termo,tipo,executado,total_resultados").eq("genre_id", gid);
      const tipoRank: Record<string, number> = { completo: 0, variacao: 1, contextual: 2, prefixo: 3, kit: 0 };
      const ordered = (allDyn ?? [])
        .filter((t: any) => (t.termo ?? "").length >= 3) // descarta prefixos curtíssimos
        .filter((t: any) => !(t.executado === true && (t.total_resultados ?? 0) === 0)) // descarta termos fracos
        .sort((a: any, b: any) => (tipoRank[a.tipo] ?? 9) - (tipoRank[b.tipo] ?? 9));
      selectedTerms = ordered.slice(0, termsCount).map((t: any) => t.termo);
    }

    // 🟢 OTIMIZAÇÃO 3: dedup case-insensitive (defesa extra)
    const seenTerms = new Set<string>();
    selectedTerms = selectedTerms.filter(t => {
      const k = t.trim().toLowerCase();
      if (!k || seenTerms.has(k)) return false;
      seenTerms.add(k);
      return true;
    });

    const { data: termsRows } = await supabase
      .from("search_terms").select("id,termo")
      .eq("genre_id", gid).in("termo", selectedTerms);
    stages.terms = { count: termsRows?.length ?? 0, list: selectedTerms, source: kit ? "kit" : "dynamic" };
    stages.cache_check = { fresh_playlists_7d: freshCount ?? 0, threshold: CACHE_THRESHOLD, cache_hit: cacheHit };

    // 2) Buscas — paralelizadas em batches (3 simultâneas no modo normal)
    // 2) Buscas — paralelizadas em batches (3 simultâneas no modo normal)
    //    🟢 OTIMIZAÇÃO 4: se cacheHit, pula coleta inteira e contabiliza economia.
    let searchedOk = 0, searchedErr = 0, totalSavedResults = 0;
    let apifyBlocked = false;
    let searchCalls = 0;
    let callsAvoided = 0;
    let playlistsReused = 0;
    const allTerms = termsRows ?? [];
    const total = allTerms.length || 1;
    const MAX_SEARCH_CALLS = 5; // limite de proteção de custo por run

    if (cacheHit) {
      callsAvoided = Math.min(allTerms.length, MAX_SEARCH_CALLS);
      playlistsReused = freshCount ?? 0;
      await setJob(supabase, gid, jobId, {
        status: "running",
        stage: `♻️ Cache fresco (${playlistsReused} playlists em ${CACHE_WINDOW_DAYS}d) — pulando coleta`,
        progress: 55,
      });
      await supabase.from("collection_logs").insert({
        genre_id: gid, acao: "cache-skip", status: "ok",
        mensagem: `Coleta pulada — ${playlistsReused} playlists reaproveitadas, ${callsAvoided} chamadas Apify evitadas`,
      });
    } else {
      await setJob(supabase, gid, jobId, { status: "running", stage: "Buscando playlists...", progress: 15 });
      let processed = 0;
      outer: for (let i = 0; i < allTerms.length; i += batchSize) {
        const batch = allTerms.slice(i, i + batchSize);
        const results = await Promise.all(batch.map((t) => {
          searchCalls++;
          return callFn("run-search", {
            genre_id: gid, term_id: t.id, search_term: t.termo, max_results: maxPerSearch,
          });
        }));
        for (const r of results) {
          const d = r.data as any;
          if (d?.blocked) { apifyBlocked = true; break; }
          if (r.ok && d?.ok) {
            searchedOk++;
            totalSavedResults += d?.savedResults ?? 0;
          } else searchedErr++;
        }
        processed += batch.length;
        await setJob(supabase, gid, jobId, {
          status: "running",
          stage: apifyBlocked
            ? "⚠️ Coleta pausada — limite de API atingido"
            : `Buscando playlists... (${processed}/${total})`,
          progress: 15 + Math.round((processed / total) * 40),
        });
        if (apifyBlocked) break outer;
        if (searchCalls >= MAX_SEARCH_CALLS) {
          await supabase.from("collection_logs").insert({
            genre_id: gid, acao: "brain-run", status: "parcial",
            mensagem: `MAX_SEARCH_CALLS (${MAX_SEARCH_CALLS}) atingido — interrompendo coleta`,
          });
          break outer;
        }
        if (delayMs > 0 && i + batchSize < allTerms.length) {
          await new Promise((res) => setTimeout(res, delayMs));
        }
      }
    }
    stages.search = {
      ok: searchedOk, err: searchedErr, total_inserted: totalSavedResults,
      calls: searchCalls, blocked: apifyBlocked,
      cache_skip: cacheHit, calls_avoided: callsAvoided, playlists_reused: playlistsReused,
    };

    // Circuit breaker: pipeline interrompido — não prossegue para enrich/analyze/briefing.
    if (apifyBlocked) {
      await supabase.from("collection_logs").insert({
        genre_id: gid, acao: "brain-run", status: "erro",
        mensagem: "Pipeline interrompido por limite do Apify",
        duracao_ms: Date.now() - start,
      });
      await setJob(supabase, gid, jobId, {
        status: "error",
        stage: "⚠️ Coleta pausada — limite de API atingido",
        progress: 0,
        error: "Pipeline interrompido por limite do Apify",
        result: { ok: false, blocked: true, reason: "APIFY_LIMIT", apify_blocked: true, stages },
      });
      return;
    }



    // 3) Filtro relaxado: relevante se nome OU descrição OU termo de origem contém o slug,
    //    o nome do gênero, OU qualquer termo selecionado nesta rodada (kit OU dinâmico).
    await setJob(supabase, gid, jobId, { status: "running", stage: "Filtrando resultados...", progress: 60 });
    const { data: allResults } = await supabase
      .from("search_results")
      .select("id,nome_playlist,descricao,term_id")
      .eq("genre_id", gid);
    const termMap = new Map((termsRows ?? []).map((t: any) => [t.id, (t.termo ?? "").toLowerCase()]));
    const nomeLower = (genre.nome ?? "").toLowerCase();
    const relevanceTokens = [
      ...selectedTerms.map(t => t.toLowerCase()),
      ...(kit ?? []).map(k => k.toLowerCase()),
      nomeLower,
    ].filter(Boolean);
    const irrelevant = (allResults ?? []).filter((r: any) => {
      const nome = (r.nome_playlist ?? "").toLowerCase();
      const desc = (r.descricao ?? "").toLowerCase();
      const termo = termMap.get(r.term_id) ?? "";
      const haystack = `${nome} ${desc} ${termo}`;
      // mantém se contém o slug, o nome do gênero OU qualquer termo relevante
      const ok = haystack.includes(slug) || relevanceTokens.some(k => k && haystack.includes(k));
      return !ok;
    });
    if (irrelevant.length > 0) {
      const ids = irrelevant.map((r: any) => r.id);
      await supabase.from("search_tracks").delete().in("result_id", ids);
      await supabase.from("search_results").delete().in("id", ids);
    }
    stages.filter = { removed: irrelevant.length, kept: (allResults?.length ?? 0) - irrelevant.length };

    // 3.5) PRIORIZAÇÃO INTELIGENTE — calcular score, threshold dinâmico, cap em max_playlists
    //   score = (1/posição)*0.4 + log10(seg+1)/log10(1e7)*0.4 + min(times_seen,5)/5*0.2 + bonusBR(0.1)
    await setJob(supabase, gid, jobId, { status: "running", stage: "Priorizando playlists...", progress: 65 });
    const { data: filt } = await supabase
      .from("genre_filters").select("max_playlists,min_followers")
      .eq("genre_id", gid).maybeSingle();
    const maxPlaylists = filt?.max_playlists ?? 150;
    const minFollowersOverride = filt?.min_followers ?? null;

    const { data: kept } = await supabase
      .from("search_results")
      .select("id,posicao,seguidores,times_seen,owner_country")
      .eq("genre_id", gid);
    const keptArr = kept ?? [];

    // Threshold dinâmico (Fase 5): só aplica se houver >=20 com followers
    const withFollowers = keptArr
      .map((r: any) => r.seguidores)
      .filter((n: any): n is number => typeof n === "number" && n > 0)
      .sort((a: number, b: number) => a - b);
    let dynamicMin = 0;
    if (minFollowersOverride && minFollowersOverride > 0) {
      dynamicMin = minFollowersOverride;
    } else if (withFollowers.length >= 20) {
      const p25 = withFollowers[Math.floor(withFollowers.length * 0.25)];
      dynamicMin = Math.max(200, p25);
    }

    // Score
    const LOG_MAX = Math.log10(1e7);
    const scored = keptArr.map((r: any) => {
      const posScore = r.posicao && r.posicao > 0 ? (1 / r.posicao) : 0;
      const folScore = typeof r.seguidores === "number" && r.seguidores > 0
        ? Math.min(1, Math.log10(r.seguidores + 1) / LOG_MAX) : 0;
      const seenScore = Math.min(5, r.times_seen ?? 1) / 5;
      const brBonus = r.owner_country === "BR" ? 0.1 : 0;
      const score = posScore * 0.4 + folScore * 0.4 + seenScore * 0.2 + brBonus;
      return { id: r.id, seguidores: r.seguidores, score };
    });
    // Aplica threshold (quem ainda não tem followers passa pra ser enriquecido depois)
    const passing = dynamicMin > 0
      ? scored.filter(s => s.seguidores == null || s.seguidores >= dynamicMin)
      : scored;
    passing.sort((a, b) => b.score - a.score);
    const selectedIds = passing.slice(0, maxPlaylists).map(s => s.id);
    const selectedSet = new Set(selectedIds);
    const droppedIds = keptArr.filter((r: any) => !selectedSet.has(r.id)).map((r: any) => r.id);

    // Persiste score em paralelo (chunks) — antes era N updates em série (~60-90s, fazia o job parecer travado)
    const CHUNK = 25;
    for (let i = 0; i < scored.length; i += CHUNK) {
      const slice = scored.slice(i, i + CHUNK);
      await Promise.all(slice.map(s =>
        supabase.from("search_results").update({ priority_score: s.score }).eq("id", s.id)
      ));
      // Heartbeat a cada 4 chunks (100 updates) pra UI saber que o job tá vivo
      if (i > 0 && i % (CHUNK * 4) === 0) {
        await setJob(supabase, gid, jobId, {
          status: "running",
          stage: `Priorizando playlists... (${Math.min(i + CHUNK, scored.length)}/${scored.length})`,
          progress: 65,
        });
      }
    }
    // Descarte das não-selecionadas em chunks (evita payload gigante no .in())
    if (droppedIds.length > 0) {
      await setJob(supabase, gid, jobId, {
        status: "running", stage: `Descartando ${droppedIds.length} de baixa prioridade...`, progress: 68,
      });
      const DEL_CHUNK = 100;
      for (let i = 0; i < droppedIds.length; i += DEL_CHUNK) {
        const ids = droppedIds.slice(i, i + DEL_CHUNK);
        await supabase.from("search_tracks").delete().in("result_id", ids);
        await supabase.from("search_results").delete().in("id", ids);
      }
    }
    stages.prioritize = {
      total_after_filter: keptArr.length,
      dynamic_min_followers: dynamicMin,
      max_playlists: maxPlaylists,
      selected: selectedIds.length,
      dropped: droppedIds.length,
    };

    // 4) Enriquecer APENAS as selecionadas (enrich seletivo — Fase 7)
    const totalForPlan = selectedIds.length;
    const { coverageTarget: COVERAGE_TARGET, maxCycles: MAX_CYCLES } =
      totalForPlan > 500 ? { coverageTarget: 0.3, maxCycles: 3 } :
      totalForPlan > 200 ? { coverageTarget: 0.5, maxCycles: 5 } :
                           { coverageTarget: 0.7, maxCycles: 8 };
    let enrichedTotal = 0, tracksTotal = 0, cycles = 0;
    let coverage = 0, totalPls = 0, enrichedCount = 0;
    let partial = false;

    async function measureCoverage() {
      const [{ count: total }, { count: enr }] = await Promise.all([
        supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", gid),
        supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", gid).not("seguidores", "is", null),
      ]);
      totalPls = total ?? 0;
      enrichedCount = enr ?? 0;
      coverage = totalPls > 0 ? enrichedCount / totalPls : 1;
    }

    await measureCoverage();
    while (coverage < COVERAGE_TARGET && cycles < MAX_CYCLES) {
      cycles++;
      await setJob(supabase, gid, jobId, {
        status: "running",
        stage: `Enriquecendo seleção... (${enrichedCount}/${totalPls} • ${Math.round(coverage * 100)}%) ciclo ${cycles}/${MAX_CYCLES}`,
        progress: 70 + Math.min(15, Math.round(coverage * 20)),
      });
      // Pendentes dentro do set selecionado, ordenadas por score
      const { data: pendIds } = await supabase
        .from("search_results")
        .select("id")
        .eq("genre_id", gid)
        .is("seguidores", null)
        .order("priority_score", { ascending: false, nullsFirst: false })
        .limit(50);
      const idsToEnrich = (pendIds ?? []).map((r: any) => r.id);
      if (idsToEnrich.length === 0) break;
      const r = await callFn("enrich-playlists", {
        genre_id: gid, limit: 50, fetch_tracks: true,
        result_ids: idsToEnrich,
      });
      const d = r.data as any;
      if (!r.ok || !d?.ok) break;
      enrichedTotal += d.enriched ?? 0;
      tracksTotal += d.tracks_saved ?? 0;
      if (!d.processed || d.processed === 0) break;
      await measureCoverage();
    }
    if (coverage < COVERAGE_TARGET) partial = true;
    stages.enrich = {
      enriched: enrichedTotal, tracks_saved: tracksTotal,
      cycles, coverage: Math.round(coverage * 100) / 100,
      enriched_count: enrichedCount, total_playlists: totalPls,
      partial, max_cycles: MAX_CYCLES, target: COVERAGE_TARGET,
    };
    await setJob(supabase, gid, jobId, {
      status: "running",
      stage: partial
        ? `Cobertura parcial (${Math.round(coverage * 100)}%) — analisando mesmo assim`
        : `Dados suficientes coletados (${Math.round(coverage * 100)}%)`,
      progress: 85,
    });

    // 5) Analisar (best-effort)
    await setJob(supabase, gid, jobId, { status: "running", stage: "Analisando padrões...", progress: 87 });
    try {
      const a = await callFn("analyze-genre", { genre_id: gid });
      stages.analyze = (a.data as any)?.insights ?? { ok: a.ok };
    } catch (e) {
      stages.analyze = { ok: false, error: (e as Error).message };
    }

    // 6) Insights IA (best-effort — não bloqueia briefing)
    await setJob(supabase, gid, jobId, { status: "running", stage: "Gerando insights...", progress: 90 });
    try {
      const ia = await callFn("genre-insights", { genre_id: gid });
      stages.insights = (ia.data as any)?.ai ?? { ok: ia.ok, error: (ia.data as any)?.error };
    } catch (e) {
      stages.insights = { ok: false, error: (e as Error).message };
    }

    // 6.5) Gerar briefing — SEMPRE tenta, com retry. Não pode pular.
    await setJob(supabase, gid, jobId, { status: "running", stage: "Gerando briefing de playlists...", progress: 95 });
    await ensureBriefing(supabase, gid, stages);

    // 7) Sincroniza contadores de genres + status
    const [pCnt, tCnt, teCnt] = await Promise.all([
      supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", gid),
      supabase.from("search_tracks").select("*", { count: "exact", head: true }).eq("genre_id", gid),
      supabase.from("search_terms").select("*", { count: "exact", head: true }).eq("genre_id", gid),
    ]);
    await supabase.from("genres").update({
      total_playlists: pCnt.count ?? 0,
      total_musicas: tCnt.count ?? 0,
      total_termos: teCnt.count ?? 0,
      ultima_coleta: new Date().toISOString(),
      status: partial ? "parcial" : "analisado",
    }).eq("id", gid);
    stages.totals = { playlists: pCnt.count ?? 0, musicas: tCnt.count ?? 0, termos: teCnt.count ?? 0 };

    // 8) Modelo final
    const { data: model } = await supabase
      .from("genre_models").select("*").eq("genre_id", gid).maybeSingle();

    const coveragePct = Math.round(coverage * 100);
    const summary = `${enrichedCount} de ${totalPls} playlists analisadas (${coveragePct}%)`;

    await supabase.from("collection_logs").insert({
      genre_id: gid, acao: "brain-run", status: partial ? "parcial" : "sucesso",
      mensagem: `Concluído em ${Math.round((Date.now() - start)/1000)}s — ${searchedOk} buscas, ${summary}, ${cycles} ciclos enrich, ${irrelevant.length} filtradas, ${tCnt.count ?? 0} faixas`,
      duracao_ms: Date.now() - start,
    });

    await setJob(supabase, gid, jobId, {
      status: "done",
      stage: partial ? `Concluído (parcial — ${coveragePct}%)` : `Concluído — ${summary}`,
      progress: 100,
      result: {
        ok: true,
        partial,
        coverage: coveragePct,
        summary,
        genre: { id: gid, nome: genre.nome, slug: genre.slug },
        duration_ms: Date.now() - start,
        stages,
        model: model ?? null,
      },
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("pipeline error", msg);
    // Antes de marcar erro, tenta gerar briefing se já existir modelo (não deixa análise sem output)
    try { await ensureBriefing(supabase, gid, stages); } catch (_) {}
    await setJob(supabase, gid, jobId, {
      status: "error", stage: "Erro", progress: 0, error: msg.slice(0, 500),
    });
  }
}

// ---------- Pipeline RESUME: continua enrich + análise sem refazer search ----------
async function resumePipeline(jobId: string, slug: string) {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const start = Date.now();
  const { data: genre } = await supabase
    .from("genres").select("id,nome,slug").eq("slug", slug).maybeSingle();
  if (!genre) {
    await supabase.from("collection_logs").insert({
      acao: `brain-job:${jobId}`, status: "erro",
      mensagem: JSON.stringify({ status: "error", stage: "resume", progress: 0, error: `Gênero '${slug}' não encontrado` }),
    });
    return;
  }
  const gid = genre.id;
  await setJob(supabase, gid, jobId, { status: "running", stage: "Retomando enriquecimento...", progress: 70 });

  try {
    let totalPls = 0, enrichedCount = 0, coverage = 0;
    let cycles = 0, enrichedTotal = 0, tracksTotal = 0;
    async function measure() {
      const [{ count: t }, { count: e }] = await Promise.all([
        supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", gid),
        supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", gid).not("seguidores", "is", null),
      ]);
      totalPls = t ?? 0; enrichedCount = e ?? 0;
      coverage = totalPls > 0 ? enrichedCount / totalPls : 1;
    }
    await measure();
    const MAX_CYCLES = totalPls > 500 ? 3 : totalPls > 200 ? 5 : 8;
    const TARGET = totalPls > 500 ? 0.5 : totalPls > 200 ? 0.7 : 0.85;
    while (coverage < TARGET && cycles < MAX_CYCLES) {
      cycles++;
      await setJob(supabase, gid, jobId, {
        status: "running",
        stage: `Retomando... (${enrichedCount}/${totalPls} • ${Math.round(coverage * 100)}%) ciclo ${cycles}/${MAX_CYCLES}`,
        progress: 70 + Math.min(15, Math.round(coverage * 20)),
      });
      const r = await callFn("enrich-playlists", {
        genre_id: gid, limit: 50, fetch_tracks: true,
        prioritize: true, keyword: slug,
      });
      const d = r.data as any;
      if (!r.ok || !d?.ok) break;
      enrichedTotal += d.enriched ?? 0;
      tracksTotal += d.tracks_saved ?? 0;
      if (!d.processed || d.processed === 0) break;
      await measure();
    }
    const partial = coverage < 0.7;
    const stages: Record<string, unknown> = {};
    await setJob(supabase, gid, jobId, { status: "running", stage: "Analisando padrões...", progress: 85 });
    try { await callFn("analyze-genre", { genre_id: gid }); } catch (_) {}
    await setJob(supabase, gid, jobId, { status: "running", stage: "Gerando insights...", progress: 90 });
    try { await callFn("genre-insights", { genre_id: gid }); } catch (_) {}
    await setJob(supabase, gid, jobId, { status: "running", stage: "Gerando briefing de playlists...", progress: 95 });
    await ensureBriefing(supabase, gid, stages);

    const [pCnt, tCnt, teCnt] = await Promise.all([
      supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", gid),
      supabase.from("search_tracks").select("*", { count: "exact", head: true }).eq("genre_id", gid),
      supabase.from("search_terms").select("*", { count: "exact", head: true }).eq("genre_id", gid),
    ]);
    await supabase.from("genres").update({
      total_playlists: pCnt.count ?? 0, total_musicas: tCnt.count ?? 0, total_termos: teCnt.count ?? 0,
      ultima_coleta: new Date().toISOString(),
      status: partial ? "parcial" : "analisado",
    }).eq("id", gid);

    const coveragePct = Math.round(coverage * 100);
    const summary = `${enrichedCount} de ${totalPls} playlists analisadas (${coveragePct}%)`;
    await supabase.from("collection_logs").insert({
      genre_id: gid, acao: "brain-resume", status: partial ? "parcial" : "sucesso",
      mensagem: `Retomada concluída — ${summary}, +${enrichedTotal} enriquecidas, +${tracksTotal} faixas, ${cycles} ciclos`,
      duracao_ms: Date.now() - start,
    });
    await setJob(supabase, gid, jobId, {
      status: "done",
      stage: partial ? `Concluído (parcial — ${coveragePct}%)` : `Concluído — ${summary}`,
      progress: 100,
      result: { ok: true, partial, coverage: coveragePct, summary, resumed: true,
        genre: { id: gid, nome: genre.nome, slug: genre.slug },
        enriched_added: enrichedTotal, tracks_added: tracksTotal, cycles, stages },
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    // Garante briefing mesmo em erro de retomada
    try { await ensureBriefing(supabase, gid, {}); } catch (_) {}
    await setJob(supabase, gid, jobId, { status: "error", stage: "Erro retomando", progress: 0, error: msg.slice(0, 500) });
  }
}

// Stale detection: se o último log do job tem >2min sem update e ainda 'running' = morreu
const STALE_MS = 120_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // GET → status
  if (req.method === "GET") {
    const url = new URL(req.url);
    const jobId = url.searchParams.get("job_id");
    if (!jobId) return jr({ error: "job_id obrigatório" }, 400);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    try {
      const job = await getJob(supabase, jobId);
      if (!job) return jr({ ok: true, status: "pending", stage: "Aguardando início...", progress: 0 });
      const updatedTs = job.updated_at ? new Date(job.updated_at).getTime() : 0;
      const ageMs = Date.now() - updatedTs;
      const isStale = job.status === "running" && ageMs > STALE_MS;
      return jr({ ok: true, ...job, stale: isStale, age_ms: ageMs });
    } catch (e) {
      return jr({ ok: true, status: "pending", stage: "Aguardando...", progress: 0, transient: true });
    }
  }

  if (req.method !== "POST") return jr({ error: "POST or GET" }, 405);

  let body: StartBody;
  try { body = await req.json(); } catch { return jr({ error: "Invalid JSON" }, 400); }
  if (!body.slug) return jr({ error: "slug obrigatório" }, 400);
  const slug = body.slug.toLowerCase();
  // Aceita qualquer slug existente em `genres`. Se houver KIT específico (funk/sertanejo/piseiro),
  // ele é usado como boost de qualidade; caso contrário, generate-terms cria os termos dinamicamente.

  // Circuit breaker GLOBAL: se Apify está bloqueado, não inicia pipeline.
  // Reset automático após 24h.
  const supabaseCheck = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: flag } = await supabaseCheck
    .from("system_flags")
    .select("id,apify_blocked,apify_blocked_at,apify_blocked_reason")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  let survivalMode = false;
  if (flag?.apify_blocked) {
    const blockedAt = flag.apify_blocked_at ? new Date(flag.apify_blocked_at).getTime() : 0;
    const ageMs = Date.now() - blockedAt;
    if (ageMs > 24 * 60 * 60 * 1000) {
      await supabaseCheck.from("system_flags").update({
        apify_blocked: false, apify_blocked_at: null, apify_blocked_reason: null,
      }).eq("id", flag.id);
    } else {
      // 🛟 MODO SOBREVIVÊNCIA: Apify bloqueado, mas seguimos com cache + IA
      survivalMode = true;
      await supabaseCheck.from("collection_logs").insert({
        acao: "survival-mode", status: "ok",
        mensagem: "Pipeline iniciado em modo sobrevivência (Apify bloqueado) — usando cache + IA",
      }).catch(() => {});
    }
  }

  const jobId = crypto.randomUUID();

  // @ts-ignore EdgeRuntime global
  if (body.action === "resume") {
    // @ts-ignore
    EdgeRuntime.waitUntil(resumePipeline(jobId, slug));
    return jr({ ok: true, job_id: jobId, status: "running", resumed: true }, 202);
  }
  // @ts-ignore
  EdgeRuntime.waitUntil(runPipeline(jobId, { ...body, survival_mode: survivalMode }));
  return jr({ ok: true, job_id: jobId, status: "running", survival_mode: survivalMode }, 202);
});
