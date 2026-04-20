// enrich-playlists — busca followers reais via Spotify Web API + tracks via Apify
// Logs granulares por playlist + retry com backoff em 429/5xx + telemetria completa.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getSpotifyToken } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY")!;
const APIFY_ACTOR = "automation-lab~spotify-scraper";

interface Body {
  genre_id?: string;
  limit?: number;
  fetch_tracks?: boolean;
  prioritize?: boolean; // ordena por posição/relevância
  keyword?: string;     // keyword principal pra boost
}

function extractPlaylistId(url: string): string | null {
  const m = url.match(/playlist\/([A-Za-z0-9]+)/);
  return m?.[1] ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type SpotifyResp = { followers: number | null; total: number | null; status: number };

async function fetchSpotifyPlaylist(id: string, token: string): Promise<SpotifyResp> {
  const url = `https://api.spotify.com/v1/playlists/${id}?fields=followers(total),tracks(total)`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) { await r.text().catch(() => ""); throw new Error("TOKEN_EXPIRED"); }
  if (r.status === 429) {
    const retry = Number(r.headers.get("Retry-After") ?? "2");
    await r.text().catch(() => "");
    throw new Error(`RATE_LIMIT:${retry}`);
  }
  if (r.status === 404) { await r.text().catch(() => ""); return { followers: null, total: null, status: 404 }; }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Spotify ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return {
    followers: j?.followers?.total ?? null,
    total: j?.tracks?.total ?? null,
    status: 200,
  };
}

async function fetchApifyTracks(playlistUrl: string): Promise<any[]> {
  const apifyUrl = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=120`;
  const r = await fetch(apifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "urls", urls: [playlistUrl], proxy: { useApifyProxy: true } }),
  });
  if (!r.ok) { await r.text().catch(() => ""); return []; }
  const items = await r.json();
  if (!Array.isArray(items) || !items[0]) return [];
  return Array.isArray(items[0].tracks) ? items[0].tracks : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const start = Date.now();
  let body: Body = {};
  try { body = await req.json(); } catch { /* default */ }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const samples: any[] = [];
  const errorSamples: any[] = [];

  try {
    const limit = Math.min(body.limit ?? 50, 100);
    const fetchTracks = body.fetch_tracks ?? true;

    // Pega playlists pendentes — prioriza por posição (melhores primeiro) quando solicitado
    let q = supabase
      .from("search_results")
      .select("id,genre_id,spotify_url,nome_playlist,posicao")
      .is("seguidores", null)
      .not("spotify_url", "is", null);
    if (body.genre_id) q = q.eq("genre_id", body.genre_id);
    q = body.prioritize
      ? q.order("posicao", { ascending: true }).limit(limit)
      : q.order("coletado_em", { ascending: false }).limit(limit);
    let { data: pending, error: pErr } = await q;
    if (pErr) throw pErr;

    // Boost: se keyword fornecida, sobe quem tem keyword no nome pro topo
    if (pending && body.keyword) {
      const kw = body.keyword.toLowerCase();
      pending = [...pending].sort((a, b) => {
        const aHas = (a.nome_playlist ?? "").toLowerCase().includes(kw) ? 0 : 1;
        const bHas = (b.nome_playlist ?? "").toLowerCase().includes(kw) ? 0 : 1;
        return aHas - bHas;
      });
    }

    console.log(`[enrich] genre=${body.genre_id ?? "all"} pending=${pending?.length ?? 0} limit=${limit}`);

    if (!pending || pending.length === 0) {
      // Conta quantas playlists totais existem pra esse gênero pra dar contexto
      let context: any = {};
      if (body.genre_id) {
        const { count: total } = await supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id);
        const { count: semUrl } = await supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id).is("spotify_url", null);
        const { count: jaEnriq } = await supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id).not("seguidores", "is", null);
        context = { total_no_genero: total, sem_spotify_url: semUrl, ja_enriquecidas: jaEnriq };
      }
      return new Response(
        JSON.stringify({ ok: true, message: "Nenhuma playlist para enriquecer", enriched: 0, processed: 0, context }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let token = await getSpotifyToken();
    let enriched = 0, tracksSaved = 0, errors = 0, skipped = 0;
    const CONCURRENCY = 5;

    // Processa uma única playlist (Spotify + Apify tracks). Mutações de contadores via refs.
    async function processOne(p: any) {
      const id = p.spotify_url ? extractPlaylistId(p.spotify_url) : null;
      if (!id) { skipped++; return; }

      // Spotify followers + total — com retry para 429/token
      let info: SpotifyResp | null = null;
      let attempts = 0;
      while (attempts < 3 && !info) {
        attempts++;
        try {
          info = await fetchSpotifyPlaylist(id, token);
        } catch (e) {
          const msg = (e as Error).message;
          if (msg === "TOKEN_EXPIRED") {
            console.log(`[enrich] token expirado, refresh (tent ${attempts})`);
            token = await getSpotifyToken(true);
            continue;
          }
          if (msg.startsWith("RATE_LIMIT:")) {
            const wait = (Number(msg.split(":")[1]) || 2) * 1000;
            console.log(`[enrich] rate limit, esperando ${wait}ms`);
            await sleep(wait);
            continue;
          }
          errors++;
          if (errorSamples.length < 5) errorSamples.push({ playlist: p.nome_playlist, id, error: msg.slice(0, 200) });
          console.error(`[enrich] erro permanente em ${p.nome_playlist}:`, msg);
          return;
        }
      }
      if (!info) return;

      const update: Record<string, unknown> = {};
      if (info.followers !== null) update.seguidores = info.followers;
      if (info.total !== null) update.total_musicas = info.total;
      if (Object.keys(update).length > 0) {
        const { error: uErr } = await supabase.from("search_results").update(update).eq("id", p.id);
        if (uErr) {
          errors++;
          console.error(`[enrich] update DB falhou em ${p.nome_playlist}:`, uErr.message);
        } else {
          enriched++;
          if (samples.length < 3) samples.push({ playlist: p.nome_playlist, followers: info.followers, total: info.total });
        }
      } else {
        skipped++;
      }

      // Tracks via Apify (apenas se solicitado) — esta é a chamada mais lenta (~10s)
      if (fetchTracks && p.genre_id) {
        try {
          const tracks = await fetchApifyTracks(p.spotify_url!);
          if (tracks.length > 0) {
            await supabase.from("search_tracks").delete().eq("result_id", p.id);
            const rows = tracks.slice(0, 100).map((t: any, idx: number) => ({
              genre_id: p.genre_id,
              result_id: p.id,
              nome_musica: t.title ?? t.name ?? "Desconhecida",
              artista: t.artists ?? t.artist ?? "Desconhecido",
              spotify_track_id: t.trackId ?? t.id ?? null,
              posicao_na_playlist: idx + 1,
            }));
            const { error: tErr } = await supabase.from("search_tracks").insert(rows);
            if (!tErr) tracksSaved += rows.length;
            else console.error(`[enrich] insert tracks falhou:`, tErr.message);
          }
        } catch (e) {
          console.error(`[enrich] apify tracks falhou em ${p.nome_playlist}:`, (e as Error).message);
        }
      }
    }

    // Roda em batches paralelos de CONCURRENCY playlists
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(processOne));
    }

    // Atualiza totais do gênero processado
    if (body.genre_id) {
      const [{ count: pCount }, { count: tCount }] = await Promise.all([
        supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id),
        supabase.from("search_tracks").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id),
      ]);
      await supabase.from("genres").update({
        total_playlists: pCount ?? 0,
        total_musicas: tCount ?? 0,
      }).eq("id", body.genre_id);
    }

    const status = errors === 0 ? "sucesso" : (enriched > 0 ? "parcial" : "erro");
    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id ?? null,
      acao: "enrich-playlists",
      status,
      mensagem: `Enriquecidas ${enriched}/${pending.length} • ${tracksSaved} tracks • ${errors} erros • ${skipped} ignoradas${errorSamples.length ? " • ex: " + errorSamples[0].error.slice(0, 80) : ""}`,
      duracao_ms: Date.now() - start,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        processed: pending.length,
        enriched,
        tracks_saved: tracksSaved,
        errors,
        skipped,
        samples,
        error_samples: errorSamples,
        remaining_estimate: pending.length === limit ? "≥ próximo lote" : 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("enrich-playlists fatal", msg);
    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id ?? null,
      acao: "enrich-playlists",
      status: "erro",
      mensagem: msg.slice(0, 500),
      duracao_ms: Date.now() - start,
    });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
