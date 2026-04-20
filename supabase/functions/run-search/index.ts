// run-search — executa um termo via Apify spotify-scraper e salva playlists + músicas
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY")!;

interface Body {
  genre_id: string;
  term_id: string;
  search_term: string;
  max_results?: number;
}

const APIFY_ACTOR = "apify~spotify-scraper";

async function runApify(searchTerm: string, maxResults: number, signal: AbortSignal) {
  const startResp = await fetch(
    `https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs?token=${APIFY_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        searchTerms: [searchTerm],
        searchType: "playlists",
        maxResults,
        proxy: { useApifyProxy: true },
      }),
    },
  );
  if (!startResp.ok) {
    const txt = await startResp.text();
    throw new Error(`Apify start failed: ${startResp.status} ${txt.slice(0, 200)}`);
  }
  const startJson = await startResp.json();
  const runId: string = startJson.data.id;
  const datasetId: string = startJson.data.defaultDatasetId;

  // Poll until SUCCEEDED / FAILED / TIMED-OUT, max 120s
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusResp = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`,
      { signal },
    );
    const statusJson = await statusResp.json();
    const status = statusJson.data.status;
    if (status === "SUCCEEDED") break;
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new Error(`Apify run ${status}`);
    }
  }

  const itemsResp = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}&clean=true&limit=${maxResults}`,
    { signal },
  );
  if (!itemsResp.ok) throw new Error(`Apify items fetch failed: ${itemsResp.status}`);
  const items = await itemsResp.json();
  return { runId, items };
}

function pickStr(o: any, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}
function pickNum(o: any, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const start = Date.now();
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  if (!body.genre_id || !body.term_id || !body.search_term) {
    return new Response(JSON.stringify({ error: "genre_id, term_id e search_term são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!APIFY_API_KEY) {
    return new Response(JSON.stringify({ error: "APIFY_API_KEY não configurada" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const maxResults = body.max_results ?? 20;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 130_000);

  try {
    // Mark genre as collecting
    await supabase.from("genres").update({ status: "coletando" }).eq("id", body.genre_id);

    const { runId, items } = await runApify(body.search_term, maxResults, controller.signal);

    let savedResults = 0;
    let savedTracks = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const nome = pickStr(it, "name", "title", "playlistName") ?? "Sem nome";
      const url = pickStr(it, "url", "spotifyUrl", "playlistUrl");
      const followers = pickNum(it, "followers", "followersCount", "totalFollowers");
      const imagem = pickStr(it, "imageUrl", "coverImage", "image");
      const descricao = pickStr(it, "description", "desc");
      const totalTracks = pickNum(it, "tracksCount", "totalTracks", "trackCount");

      const { data: inserted, error: insErr } = await supabase
        .from("search_results")
        .insert({
          genre_id: body.genre_id,
          term_id: body.term_id,
          nome_playlist: nome,
          posicao: i + 1,
          spotify_url: url,
          seguidores: followers,
          imagem_url: imagem,
          descricao,
          total_musicas: totalTracks,
          apify_run_id: runId,
        })
        .select("id")
        .single();

      if (insErr) {
        console.error("insert result err", insErr);
        continue;
      }
      savedResults++;

      // tracks (best-effort — actor may or may not return them)
      const tracks = it.tracks ?? it.songs ?? [];
      if (Array.isArray(tracks) && tracks.length > 0) {
        const trackRows = tracks.slice(0, 100).map((t: any, idx: number) => ({
          genre_id: body.genre_id,
          result_id: inserted.id,
          nome_musica: pickStr(t, "name", "title", "trackName") ?? "Desconhecida",
          artista: pickStr(t, "artist", "artistName", "artists") ?? "Desconhecido",
          spotify_track_id: pickStr(t, "id", "trackId", "spotifyId"),
          posicao_na_playlist: idx + 1,
        }));
        const { error: trkErr } = await supabase.from("search_tracks").insert(trackRows);
        if (!trkErr) savedTracks += trackRows.length;
      }
    }

    // Update term as executed
    await supabase
      .from("search_terms")
      .update({ executado: true, total_resultados: savedResults, ultima_execucao: new Date().toISOString() })
      .eq("id", body.term_id);

    // Recompute genre counters
    const [{ count: pCount }, { count: tCount }] = await Promise.all([
      supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id),
      supabase.from("search_tracks").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id),
    ]);
    await supabase.from("genres").update({
      total_playlists: pCount ?? 0,
      total_musicas: tCount ?? 0,
      ultima_coleta: new Date().toISOString(),
      status: "coletando",
    }).eq("id", body.genre_id);

    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      term_id: body.term_id,
      acao: "run-search",
      status: "sucesso",
      mensagem: `"${body.search_term}" → ${savedResults} playlists, ${savedTracks} músicas`,
      duracao_ms: Date.now() - start,
    });

    clearTimeout(timeout);
    return new Response(
      JSON.stringify({ ok: true, savedResults, savedTracks, runId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    clearTimeout(timeout);
    const msg = (e as Error).message ?? String(e);
    console.error("run-search error", msg);
    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      term_id: body.term_id,
      acao: "run-search",
      status: "erro",
      mensagem: msg.slice(0, 500),
      duracao_ms: Date.now() - start,
    });
    // Don't mark genre as 'erro' — allow next term to continue
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200, // soft error, orchestrator continues
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
