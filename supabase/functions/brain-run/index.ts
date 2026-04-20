// brain-run — orquestra pipeline em BACKGROUND para evitar timeout (150s).
// POST { slug, intensity?, max_playlists? }            → { ok, job_id }
// GET  ?job_id=...                                     → { ok, status, stage, progress, result? }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Intensity = "leve" | "normal" | "agressivo";

interface StartBody {
  slug: string;
  intensity?: Intensity;
  max_playlists?: 20 | 50 | 100;
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
    case "leve":      return { termsCount: 5,  delayMs: 2500 };
    case "agressivo": return { termsCount: 12, delayMs: 1000 };
    default:          return { termsCount: 8,  delayMs: 1500 };
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
  const kit = KITS[slug];
  const { termsCount, delayMs } = intensityLimits(body.intensity ?? "normal");
  const maxPerSearch = body.max_playlists ?? 50;
  const start = Date.now();

  const { data: genre } = await supabase
    .from("genres").select("id,nome,slug").eq("slug", slug).maybeSingle();
  if (!genre) {
    // Não temos genreId — guarda erro num log órfão
    await supabase.from("collection_logs").insert({
      acao: `brain-job:${jobId}`, status: "erro",
      mensagem: JSON.stringify({ status: "error", stage: "init", progress: 0, error: `Gênero '${slug}' não encontrado` }),
    });
    return;
  }
  const gid = genre.id;
  await setJob(supabase, gid, jobId, { status: "running", stage: "Gerando termos...", progress: 5 });

  const stages: Record<string, unknown> = {};

  try {
    // 1) Termos
    const selectedTerms = kit.slice(0, termsCount);
    const { data: existingTerms } = await supabase
      .from("search_terms").select("id,termo").eq("genre_id", gid);
    const existingMap = new Map((existingTerms ?? []).map((t: any) => [t.termo.toLowerCase(), t.id]));
    const missing = selectedTerms.filter(t => !existingMap.has(t.toLowerCase()));
    if (missing.length > 0) {
      await supabase.from("search_terms").insert(
        missing.map(t => ({ genre_id: gid, termo: t, tipo: "kit" })),
      );
    }
    const { data: termsRows } = await supabase
      .from("search_terms").select("id,termo")
      .eq("genre_id", gid).in("termo", selectedTerms);
    stages.terms = { count: termsRows?.length ?? 0, list: selectedTerms };

    // 2) Buscas
    await setJob(supabase, gid, jobId, { status: "running", stage: "Buscando playlists...", progress: 15 });
    let searchedOk = 0, searchedErr = 0, totalSavedResults = 0;
    const total = (termsRows ?? []).length || 1;
    let idx = 0;
    for (const t of (termsRows ?? [])) {
      const r = await callFn("run-search", {
        genre_id: gid, term_id: t.id, search_term: t.termo, max_results: maxPerSearch,
      });
      if (r.ok && (r.data as any)?.ok) {
        searchedOk++;
        totalSavedResults += (r.data as any)?.savedResults ?? 0;
      } else searchedErr++;
      idx++;
      await setJob(supabase, gid, jobId, {
        status: "running",
        stage: `Buscando playlists... (${idx}/${total})`,
        progress: 15 + Math.round((idx / total) * 40),
      });
      if (delayMs > 0) await new Promise(res => setTimeout(res, delayMs));
    }
    stages.search = { ok: searchedOk, err: searchedErr, total_inserted: totalSavedResults };

    // 3) Filtro relaxado: relevante se nome OU descrição OU termo de origem contém o slug
    //    OU qualquer um dos termos do kit (ex.: "mandelão" pra funk).
    await setJob(supabase, gid, jobId, { status: "running", stage: "Filtrando resultados...", progress: 60 });
    const { data: allResults } = await supabase
      .from("search_results")
      .select("id,nome_playlist,descricao,term_id")
      .eq("genre_id", gid);
    const termMap = new Map((termsRows ?? []).map((t: any) => [t.id, (t.termo ?? "").toLowerCase()]));
    const kitLower = kit.map(k => k.toLowerCase());
    const irrelevant = (allResults ?? []).filter((r: any) => {
      const nome = (r.nome_playlist ?? "").toLowerCase();
      const desc = (r.descricao ?? "").toLowerCase();
      const termo = termMap.get(r.term_id) ?? "";
      const haystack = `${nome} ${desc} ${termo}`;
      // mantém se contém o slug OU qualquer palavra-chave do kit
      const ok = haystack.includes(slug) || kitLower.some(k => haystack.includes(k));
      return !ok;
    });
    if (irrelevant.length > 0) {
      const ids = irrelevant.map((r: any) => r.id);
      await supabase.from("search_tracks").delete().in("result_id", ids);
      await supabase.from("search_results").delete().in("id", ids);
    }
    stages.filter = { removed: irrelevant.length, kept: (allResults?.length ?? 0) - irrelevant.length };

    // 4) Enriquecer
    await setJob(supabase, gid, jobId, { status: "running", stage: "Enriquecendo dados...", progress: 70 });
    let enrichedTotal = 0, tracksTotal = 0;
    for (let i = 0; i < 3; i++) {
      const r = await callFn("enrich-playlists", { genre_id: gid, limit: 50, fetch_tracks: true });
      const d = r.data as any;
      if (!r.ok || !d?.ok) break;
      enrichedTotal += d.enriched ?? 0;
      tracksTotal += d.tracks_saved ?? 0;
      if (!d.processed || d.processed < 50) break;
    }
    stages.enrich = { enriched: enrichedTotal, tracks_saved: tracksTotal };

    // 5) Analisar
    await setJob(supabase, gid, jobId, { status: "running", stage: "Analisando padrões...", progress: 85 });
    const a = await callFn("analyze-genre", { genre_id: gid });
    stages.analyze = (a.data as any)?.insights ?? { ok: a.ok };

    // 6) Insights IA
    await setJob(supabase, gid, jobId, { status: "running", stage: "Gerando insights...", progress: 92 });
    const ia = await callFn("genre-insights", { genre_id: gid });
    stages.insights = (ia.data as any)?.ai ?? { ok: ia.ok, error: (ia.data as any)?.error };

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
      status: "analisado",
    }).eq("id", gid);
    stages.totals = { playlists: pCnt.count ?? 0, musicas: tCnt.count ?? 0, termos: teCnt.count ?? 0 };

    // 8) Modelo final
    const { data: model } = await supabase
      .from("genre_models").select("*").eq("genre_id", gid).maybeSingle();

    await supabase.from("collection_logs").insert({
      genre_id: gid, acao: "brain-run", status: "sucesso",
      mensagem: `Concluído em ${Math.round((Date.now() - start)/1000)}s — ${searchedOk} buscas, ${enrichedTotal} enriquecidas, ${irrelevant.length} filtradas, ${tCnt.count ?? 0} faixas no banco`,
      duracao_ms: Date.now() - start,
    });

    await setJob(supabase, gid, jobId, {
      status: "done",
      stage: "Concluído",
      progress: 100,
      result: {
        ok: true,
        genre: { id: gid, nome: genre.nome, slug: genre.slug },
        duration_ms: Date.now() - start,
        stages,
        model: model ?? null,
      },
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("pipeline error", msg);
    await setJob(supabase, gid, jobId, {
      status: "error", stage: "Erro", progress: 0, error: msg.slice(0, 500),
    });
  }
}

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
      // Nunca 404 — retorna 'pending' se ainda não houver log (job acabou de iniciar)
      if (!job) return jr({ ok: true, status: "pending", stage: "Aguardando início...", progress: 0 });
      return jr({ ok: true, ...job });
    } catch (e) {
      // Erro transitório de DB — devolve 200 com status pending para o cliente continuar polling
      return jr({ ok: true, status: "pending", stage: "Aguardando...", progress: 0, transient: true });
    }
  }

  if (req.method !== "POST") return jr({ error: "POST or GET" }, 405);

  let body: StartBody;
  try { body = await req.json(); } catch { return jr({ error: "Invalid JSON" }, 400); }
  if (!body.slug) return jr({ error: "slug obrigatório" }, 400);
  const slug = body.slug.toLowerCase();
  if (!KITS[slug]) return jr({ error: `Nicho '${slug}' sem kit. Suportados: ${Object.keys(KITS).join(", ")}` }, 400);

  const jobId = crypto.randomUUID();

  // Dispara em background — retorna imediatamente
  // @ts-ignore EdgeRuntime global
  EdgeRuntime.waitUntil(runPipeline(jobId, body));

  return jr({ ok: true, job_id: jobId, status: "running" }, 202);
});
