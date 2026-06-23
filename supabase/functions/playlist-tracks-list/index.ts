// playlist-tracks-list — lista faixas atuais de uma playlist via Spotify Web API.
// Body: { playlist_id: uuid }  (uuid de public.playlists)
// Retorna: { ok, tracks: [{ spotify_track_id, name, artists, album_cover, duration_ms, added_at }] }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAppToken, SpotifyCircuitOpenError } from "../_shared/spotify-client.ts";
import {
  listPlaylistTracksRich,
  SpotifyApiError,
  defaultSpotifyFetch,
  type SpotifyFetch,
} from "../_shared/spotify-playlist.ts";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetcher com throttle entre páginas (150ms) e retry automático em 429 / 5xx
 * usando Retry-After (cap em 8s, máx 3 tentativas).
 */
function makeThrottledFetcher(): SpotifyFetch {
  let lastCallAt = 0;
  const minGapMs = 150;
  return async (url, init, token) => {
    const wait = Math.max(0, minGapMs - (Date.now() - lastCallAt));
    if (wait > 0) await sleep(wait);
    let attempt = 0;
     
    while (true) {
      try {
        lastCallAt = Date.now();
        return await defaultSpotifyFetch(url, init, token);
      } catch (e) {
        const err = e as SpotifyApiError;
        const isRetryable = err?.status === 429 || (err?.status >= 500 && err?.status < 600);
        if (!isRetryable || attempt >= 2) throw err;
        const retryAfterSec = Math.min(8, Math.max(1, err.retryAfter ?? Math.pow(2, attempt)));
        await sleep(retryAfterSec * 1000);
        attempt++;
      }
    }
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: any;
  try { body = await req.json(); } catch { return jr({ error: "Invalid JSON" }, 400); }
  const playlist_id = String(body?.playlist_id ?? "").trim();
  if (!playlist_id) return jr({ error: "playlist_id obrigatório" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Aceita tanto playlists.id (canonical) quanto managed_playlists.id
  let spotifyPlaylistId: string | null = null;
  let managedPlaylistId: string | null = null;
  let ownerSpotifyId: string | null = null;
  const { data: pl, error: plErr } = await supabase
    .from("playlists")
    .select("id, spotify_playlist_id")
    .eq("id", playlist_id)
    .maybeSingle();
  if (plErr) return jr({ ok: false, error: plErr.message }, 500);
  if (pl?.spotify_playlist_id) {
    spotifyPlaylistId = pl.spotify_playlist_id;
  } else {
    const { data: mp, error: mpErr } = await supabase
      .from("managed_playlists")
      .select("id, spotify_playlist_id, owner_spotify_user_id")
      .eq("id", playlist_id)
      .maybeSingle();
    if (mpErr) return jr({ ok: false, error: mpErr.message }, 500);
    spotifyPlaylistId = mp?.spotify_playlist_id ?? null;
    managedPlaylistId = mp?.id ?? null;
    ownerSpotifyId = (mp as any)?.owner_spotify_user_id ?? null;
  }
  // Mesmo vindo de `playlists`, tenta achar o managed equivalente pelo spotify_playlist_id pra ter cache + owner.
  if (!managedPlaylistId && spotifyPlaylistId) {
    const { data: mp2 } = await supabase
      .from("managed_playlists")
      .select("id, owner_spotify_user_id")
      .eq("spotify_playlist_id", spotifyPlaylistId)
      .maybeSingle();
    managedPlaylistId = mp2?.id ?? null;
    ownerSpotifyId = ownerSpotifyId ?? ((mp2 as any)?.owner_spotify_user_id ?? null);
  }
  if (!spotifyPlaylistId) {
    return jr({
      ok: false,
      code: "playlist_not_found",
      error: "playlist não encontrada",
      tracks: [],
      total: 0,
    });
  }

  async function loadCache(): Promise<{ tracks: any[]; snapshot_at: string | null }> {
    if (!managedPlaylistId) return { tracks: [], snapshot_at: null };
    const { data, error } = await supabase
      .from("managed_playlist_tracks")
      .select("spotify_track_id, track_name, artist_name, album_cover, duration_ms, added_at, position, snapshot_at")
      .eq("playlist_id", managedPlaylistId)
      .order("position", { ascending: true });
    if (error || !data) return { tracks: [], snapshot_at: null };
    const tracks = data.map((t: any) => ({
      spotify_track_id: t.spotify_track_id,
      name: t.track_name || "Unknown",
      artists: t.artist_name ?? "",
      album_cover: t.album_cover ?? null,
      duration_ms: t.duration_ms ?? 0,
      added_at: t.added_at,
    }));
    const snapshot_at = data[0]?.snapshot_at ?? null;
    return { tracks, snapshot_at };
  }

  try {
    // Arquitetura nova: exclusivamente Client Credentials (sem OAuth).
    // Playlists públicas funcionam normalmente; privadas/colaborativas devolvem 401/403
    // do Spotify e são reportadas como `not_public` (sem fallback OAuth).
    const token = await getAppToken({
      functionName: "playlist-tracks-list",
      operation: "list_tracks_app_token",
    });
    const fetcher = makeThrottledFetcher();
    const rich = await listPlaylistTracksRich(spotifyPlaylistId, token, {
      max: 10000,
      fields: "items(added_at,track(id,name,duration_ms,artists(name),album(images)),item(id,name,duration_ms,artists(name),album(images))),next",
      fetcher,
    });
    const out = rich
      .filter((t) => t.spotify_track_id)
      .map((t) => ({
        spotify_track_id: t.spotify_track_id,
        name: t.name || "Unknown",
        artists: t.artists,
        album_cover: t.album_cover,
        duration_ms: t.duration_ms,
        added_at: t.added_at,
      }));
    return jr({ ok: true, source: "spotify", tracks: out, total: out.length });
  } catch (e) {
    // Circuit breaker aberto: tenta servir cache local antes de devolver 503.
    if (e instanceof SpotifyCircuitOpenError) {
      // blockedUntil pode ser string ISO, Date ou null/undefined — normaliza com segurança.
      const rawBlocked: unknown = (e as any).blockedUntil;
      let blockedUntilIso: string | null = null;
      let blockedUntilMs: number | null = null;
      if (rawBlocked instanceof Date) {
        blockedUntilMs = rawBlocked.getTime();
        blockedUntilIso = rawBlocked.toISOString();
      } else if (typeof rawBlocked === "string" && rawBlocked.length > 0) {
        const parsed = Date.parse(rawBlocked);
        if (!Number.isNaN(parsed)) {
          blockedUntilMs = parsed;
          blockedUntilIso = new Date(parsed).toISOString();
        }
      }
      const retryAfter = blockedUntilMs
        ? Math.max(1, Math.ceil((blockedUntilMs - Date.now()) / 1000))
        : 15;

      // Fallback: serve cache local se houver, evitando bloquear o Editor.
      const cache = await loadCache();
      if (cache.tracks.length > 0) {
        return jr({
          ok: true,
          source: "cache",
          cache_snapshot_at: cache.snapshot_at,
          rate_limited: true,
          retry_after: retryAfter,
          blocked_until: blockedUntilIso,
          message: "Spotify temporariamente indisponível. Exibindo última sincronização.",
          tracks: cache.tracks,
          total: cache.tracks.length,
        });
      }

      return jr({
        ok: false,
        error: "SPOTIFY_CIRCUIT_OPEN",
        code: "spotify_circuit_open",
        message: "Spotify API temporariamente bloqueada pelo circuit breaker.",
        blocked_until: blockedUntilIso,
        retry_after: retryAfter,
        fallback: true,
        tracks: [],
        total: 0,
      }, 503);
    }
    const err = e as SpotifyApiError;
    const status = err?.status;

    // 401/403: playlist privada ou colaborativa — exigiria OAuth, fora desta arquitetura.
    if (status === 401 || status === 403) {
      return jr({
        ok: false,
        code: "not_public",
        error: "playlist_not_public",
        message: "Playlist não é pública. A arquitetura nova consulta apenas playlists públicas via Client Credentials.",
        status,
        tracks: [],
        total: 0,
      }, 200);
    }

    const rateLimited = status === 429 || /429|too many requests/i.test(err?.message ?? "");
    const retryAfter = rateLimited
      ? Math.min(60, Math.max(2, err?.retryAfter ?? 10))
      : null;
    // Fallback: tenta servir do cache local apenas em 429 direto (não em circuit open).
    if (rateLimited) {
      const cache = await loadCache();
      if (cache.tracks.length > 0) {
        return jr({
          ok: true,
          source: "cache",
          cache_snapshot_at: cache.snapshot_at,
          tracks: cache.tracks,
          total: cache.tracks.length,
        });
      }
    }
    return jr({
      ok: false,
      error: rateLimited ? "RATE_LIMITED" : (err?.message ?? "unknown"),
      code: rateLimited ? "rate_limited" : "spotify_error",
      retry_after: retryAfter,
      fallback: true,
      tracks: [],
      total: 0,
    });
  }
});
