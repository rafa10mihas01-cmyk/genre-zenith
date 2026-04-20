// enrich-playlists — busca followers reais via Spotify Web API + tracks via Apify
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
}

function extractPlaylistId(url: string): string | null {
  // formats: https://open.spotify.com/playlist/<id>(?si=...)
  const m = url.match(/playlist\/([A-Za-z0-9]+)/);
  return m?.[1] ?? null;
}

async function fetchSpotifyPlaylist(id: string, token: string) {
  const url = `https://api.spotify.com/v1/playlists/${id}?fields=followers(total),tracks(total)`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) throw new Error("TOKEN_EXPIRED");
  if (r.status === 404) return { followers: null, total: null, status: 404 };
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
    body: JSON.stringify({
      mode: "urls",
      urls: [playlistUrl],
      proxy: { useApifyProxy: true },
    }),
  });
  if (!r.ok) return [];
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

  try {
    const limit = Math.min(body.limit ?? 50, 100);
    const fetchTracks = body.fetch_tracks ?? true;

    // Pega playlists pendentes
    let q = supabase
      .from("search_results")
      .select("id,genre_id,spotify_url,nome_playlist")
      .is("seguidores", null)
      .not("spotify_url", "is", null)
      .order("coletado_em", { ascending: false })
      .limit(limit);
    if (body.genre_id) q = q.eq("genre_id", body.genre_id);
    const { data: pending, error: pErr } = await q;
    if (pErr) throw pErr;
    if (!pending || pending.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, message: "Nenhuma playlist para enriquecer", enriched: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let token = await getSpotifyToken();
    let enriched = 0, tracksSaved = 0, errors = 0;

    for (const p of pending) {
      const id = p.spotify_url ? extractPlaylistId(p.spotify_url) : null;
      if (!id) continue;

      // Spotify followers + total
      let info: { followers: number | null; total: number | null; status: number };
      try {
        info = await fetchSpotifyPlaylist(id, token);
      } catch (e) {
        if ((e as Error).message === "TOKEN_EXPIRED") {
          token = await getSpotifyToken(true);
          try { info = await fetchSpotifyPlaylist(id, token); }
          catch { errors++; continue; }
        } else { errors++; continue; }
      }

      const update: Record<string, unknown> = {};
      if (info.followers !== null) update.seguidores = info.followers;
      if (info.total !== null) update.total_musicas = info.total;
      if (Object.keys(update).length > 0) {
        await supabase.from("search_results").update(update).eq("id", p.id);
        enriched++;
      }

      // Tracks via Apify (only if requested)
      if (fetchTracks && p.genre_id) {
        try {
          const tracks = await fetchApifyTracks(p.spotify_url!);
          if (tracks.length > 0) {
            // Limpa antigas desse result_id antes de inserir (idempotente)
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
          }
        } catch { /* skip tracks */ }
      }
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

    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id ?? null,
      acao: "enrich-playlists",
      status: errors > 0 ? "parcial" : "sucesso",
      mensagem: `Enriquecidas ${enriched}/${pending.length} playlists, ${tracksSaved} tracks salvas, ${errors} erros`,
      duracao_ms: Date.now() - start,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        processed: pending.length,
        enriched,
        tracks_saved: tracksSaved,
        errors,
        remaining_estimate: pending.length === limit ? "≥ próximo lote" : 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("enrich-playlists error", msg);
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
