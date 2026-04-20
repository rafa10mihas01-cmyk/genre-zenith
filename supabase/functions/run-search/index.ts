// run-search — executa um termo via Apify automation-lab/spotify-scraper e salva playlists + músicas
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

const APIFY_ACTOR = "automation-lab~spotify-scraper";

async function runApify(searchTerm: string, maxResults: number, signal: AbortSignal) {
  // Synchronous run — returns dataset items directly. Timeout 120s.
  const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=120`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      mode: "search",
      searchTerms: [searchTerm],
      searchType: "playlists",
      maxResults,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Apify ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const items = await resp.json();
  // runId is in headers
  const runId = resp.headers.get("x-apify-pagination-total") ?? null;
  return { runId, items: Array.isArray(items) ? items : [] };
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
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  if (!body.genre_id || !body.term_id || !body.search_term) {
    return new Response(JSON.stringify({ error: "genre_id, term_id e search_term são obrigatórios" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!APIFY_API_KEY) {
    return new Response(JSON.stringify({ error: "APIFY_API_KEY não configurada" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const maxResults = body.max_results ?? 20;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), 130_000);

  try {
    await supabase.from("genres").update({ status: "coletando" }).eq("id", body.genre_id);

    const { runId, items } = await runApify(body.search_term, maxResults, controller.signal);

    let savedResults = 0;
    let savedTracks = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      // Filter: only playlist items
      if (it.type && it.type !== "playlist") continue;

      const nome = pickStr(it, "name", "title", "playlistName") ?? "Sem nome";
      const url = pickStr(it, "url", "spotifyUrl", "playlistUrl");
      const followers = pickNum(it, "followers", "followersCount", "totalFollowers");
      const imagem = pickStr(it, "imageUrl", "coverImage", "image");
      const descricao = pickStr(it, "description", "desc");
      const totalTracks = pickNum(it, "trackCount", "tracksCount", "totalTracks");

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

      const tracks = Array.isArray(it.tracks) ? it.tracks : [];
      if (tracks.length > 0) {
        const trackRows = tracks.slice(0, 100).map((t: any, idx: number) => {
          let artista = pickStr(t, "artist", "artistName") ?? "Desconhecido";
          if (Array.isArray(t.artists)) {
            artista = t.artists.map((a: any) => typeof a === "string" ? a : (a.name ?? a.artist ?? "")).filter(Boolean).join(", ") || artista;
          }
          return {
            genre_id: body.genre_id,
            result_id: inserted.id,
            nome_musica: pickStr(t, "name", "title", "trackName") ?? "Desconhecida",
            artista,
            spotify_track_id: pickStr(t, "id", "trackId", "spotifyId"),
            posicao_na_playlist: idx + 1,
          };
        });
        const { error: trkErr } = await supabase.from("search_tracks").insert(trackRows);
        if (!trkErr) savedTracks += trackRows.length;
        else console.error("insert tracks err", trkErr);
      }
    }

    await supabase
      .from("search_terms")
      .update({ executado: true, total_resultados: savedResults, ultima_execucao: new Date().toISOString() })
      .eq("id", body.term_id);

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

    clearTimeout(timeoutHandle);
    return new Response(
      JSON.stringify({ ok: true, savedResults, savedTracks, runId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    clearTimeout(timeoutHandle);
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
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200, // soft error so orchestrator continues
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
