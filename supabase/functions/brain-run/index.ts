// brain-run — orquestra pipeline completa para um nicho:
// kit de termos → run-search (filtrado) → enrich-playlists → analyze-genre → genre-insights
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Intensity = "leve" | "normal" | "agressivo";

interface Body {
  slug: "funk" | "sertanejo" | "piseiro" | string;
  intensity?: Intensity;
  max_playlists?: 20 | 50 | 100;
}

// Kits curados por nicho
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  let body: Body;
  try { body = await req.json(); } catch { return jr({ error: "Invalid JSON" }, 400); }
  if (!body.slug) return jr({ error: "slug obrigatório" }, 400);

  const slug = body.slug.toLowerCase();
  const kit = KITS[slug];
  if (!kit) return jr({ error: `Nicho '${slug}' não tem kit curado. Suportados: ${Object.keys(KITS).join(", ")}` }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { termsCount, delayMs } = intensityLimits(body.intensity ?? "normal");
  const maxPerSearch = body.max_playlists ?? 50;
  const start = Date.now();

  // 1) Buscar genre
  const { data: genre, error: gErr } = await supabase
    .from("genres").select("id,nome,slug").eq("slug", slug).maybeSingle();
  if (gErr || !genre) return jr({ error: `Gênero '${slug}' não encontrado` }, 404);

  await supabase.from("collection_logs").insert({
    genre_id: genre.id, acao: "brain-run", status: "sucesso",
    mensagem: `Iniciado: ${termsCount} termos, ${maxPerSearch} playlists/termo, intensidade=${body.intensity ?? "normal"}`,
  });

  const stages: Record<string, unknown> = {};

  // 2) Termos: garantir que kit existe em search_terms (apenas os do kit, fatiados pela intensidade)
  const selectedTerms = kit.slice(0, termsCount);
  const { data: existingTerms } = await supabase
    .from("search_terms").select("id,termo").eq("genre_id", genre.id);
  const existingMap = new Map((existingTerms ?? []).map(t => [t.termo.toLowerCase(), t.id]));
  const missing = selectedTerms.filter(t => !existingMap.has(t.toLowerCase()));
  if (missing.length > 0) {
    await supabase.from("search_terms").insert(
      missing.map(t => ({ genre_id: genre.id, termo: t, tipo: "kit" })),
    );
  }
  // re-fetch para pegar ids
  const { data: termsRows } = await supabase
    .from("search_terms").select("id,termo")
    .eq("genre_id", genre.id)
    .in("termo", selectedTerms);
  stages.terms = { count: termsRows?.length ?? 0, list: selectedTerms };

  // 3) Rodar busca para cada termo
  let searchedOk = 0, searchedErr = 0, totalSavedResults = 0;
  for (const t of (termsRows ?? [])) {
    const r = await callFn("run-search", {
      genre_id: genre.id,
      term_id: t.id,
      search_term: t.termo,
      max_results: maxPerSearch,
    });
    if (r.ok && (r.data as any)?.ok) {
      searchedOk++;
      totalSavedResults += (r.data as any)?.savedResults ?? 0;
    } else searchedErr++;
    if (delayMs > 0) await new Promise(res => setTimeout(res, delayMs));
  }
  stages.search = { ok: searchedOk, err: searchedErr, total_inserted: totalSavedResults };

  // 4) Filtro de relevância: deletar playlists que NÃO contêm a palavra do nicho no nome
  // Mantém somente quem tem `slug` (ex: "funk", "sertanejo", "piseiro") no nome (case-insensitive)
  const keyword = slug;
  const { data: allResults } = await supabase
    .from("search_results").select("id,nome_playlist").eq("genre_id", genre.id);
  const irrelevant = (allResults ?? []).filter(r =>
    !(r.nome_playlist ?? "").toLowerCase().includes(keyword)
  );
  if (irrelevant.length > 0) {
    const ids = irrelevant.map(r => r.id);
    // Apaga tracks dependentes primeiro
    await supabase.from("search_tracks").delete().in("result_id", ids);
    await supabase.from("search_results").delete().in("id", ids);
  }
  stages.filter = { removed: irrelevant.length, kept: (allResults?.length ?? 0) - irrelevant.length };

  // 5) Enriquecer playlists (followers via Spotify + tracks via Apify) — em batches
  let enrichedTotal = 0, tracksTotal = 0;
  for (let i = 0; i < 3; i++) {
    const r = await callFn("enrich-playlists", { genre_id: genre.id, limit: 50, fetch_tracks: true });
    const d = r.data as any;
    if (!r.ok || !d?.ok) break;
    enrichedTotal += d.enriched ?? 0;
    tracksTotal += d.tracks_saved ?? 0;
    if (!d.processed || d.processed < 50) break;
  }
  stages.enrich = { enriched: enrichedTotal, tracks_saved: tracksTotal };

  // 6) Analisar gênero
  const a = await callFn("analyze-genre", { genre_id: genre.id });
  stages.analyze = (a.data as any)?.insights ?? { ok: a.ok };

  // 7) Insights IA (não falha se erro)
  const ia = await callFn("genre-insights", { genre_id: genre.id });
  stages.insights = (ia.data as any)?.ai ?? { ok: ia.ok, error: (ia.data as any)?.error };

  // 8) Buscar modelo final para devolver
  const { data: model } = await supabase
    .from("genre_models").select("*").eq("genre_id", genre.id).maybeSingle();

  await supabase.from("collection_logs").insert({
    genre_id: genre.id, acao: "brain-run", status: "sucesso",
    mensagem: `Concluído em ${Math.round((Date.now() - start)/1000)}s — ${searchedOk} buscas, ${enrichedTotal} enriquecidas, ${irrelevant.length} filtradas`,
    duracao_ms: Date.now() - start,
  });

  return jr({
    ok: true,
    genre: { id: genre.id, nome: genre.nome, slug: genre.slug },
    duration_ms: Date.now() - start,
    stages,
    model: model ?? null,
  });
});
