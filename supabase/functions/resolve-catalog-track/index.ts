// resolve-catalog-track — Etapa 1 do fluxo de catálogo.
// Recebe URL/URI/Track ID, resolve a faixa no Spotify e devolve metadados
// + detecção de gênero (cruzando artist.genres[] com genre_aliases).
// Sem efeitos colaterais. Idempotente.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchAlbumTracks, getArtistCacheBatch, hydrateTrackSync } from "../_shared/spotify-cache.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const TRACK_ID_RE = /^[A-Za-z0-9]{22}$/;
const TRACK_URL_RE = /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})/i;
const TRACK_URI_RE = /^spotify:track:([A-Za-z0-9]{22})$/i;
const ALBUM_URL_RE = /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?album\/([A-Za-z0-9]{22})/i;
const ALBUM_URI_RE = /^spotify:album:([A-Za-z0-9]{22})$/i;

type Resolved =
  | { kind: "track"; id: string }
  | { kind: "album"; id: string }
  | null;

function resolveInput(input: string): Resolved {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (TRACK_ID_RE.test(s)) return { kind: "track", id: s };
  const uri = s.match(TRACK_URI_RE);
  if (uri) return { kind: "track", id: uri[1] };
  const url = s.match(TRACK_URL_RE);
  if (url) return { kind: "track", id: url[1] };
  const aUri = s.match(ALBUM_URI_RE);
  if (aUri) return { kind: "album", id: aUri[1] };
  const aUrl = s.match(ALBUM_URL_RE);
  if (aUrl) return { kind: "album", id: aUrl[1] };
  return null;
}


function joinArtists(artists: Array<{ name: string }>): string {
  return artists.map((a) => a.name).filter(Boolean).join(", ");
}

// Normaliza string Spotify pra match no genre_aliases (lowercased ASCII).
function normalizeSpotifyGenre(g: string): string {
  return g
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const inputRaw =
      typeof body?.input === "string" ? body.input :
      typeof body?.spotify_track_id === "string" ? body.spotify_track_id :
      typeof body?.url === "string" ? body.url :
      typeof body?.uri === "string" ? body.uri : "";

    const resolved = resolveInput(inputRaw);
    if (!resolved) {
      return jr({
        ok: false, error: "invalid_input",
        message: "Envie um Spotify track/álbum: ID (22 chars), URI (spotify:track:... / spotify:album:...) ou URL (open.spotify.com/track/... ou /album/...).",
      }, 200);
    }

    let trackId = resolved.kind === "track" ? resolved.id : "";
    // Álbum: resolve a única track se for single; se tiver múltiplas, devolve a lista pra UI escolher.
    if (resolved.kind === "album") {
      const alb = await fetchAlbumTracks(resolved.id, "resolve-catalog-track");
      if (!alb.ok) {
        return jr({
          ok: false, error: alb.error, details: alb.details ?? null,
          spotify_album_id: resolved.id,
        }, alb.status === 404 ? 404 : alb.status >= 500 ? 502 : alb.status);
      }
      if (alb.tracks.length === 0) {
        return jr({ ok: false, error: "album_empty", message: "Álbum sem faixas disponíveis.", spotify_album_id: resolved.id }, 200);
      }
      if (alb.tracks.length === 1) {
        trackId = alb.tracks[0].id;
      } else {
        // Múltiplas faixas — UI decide qual usar.
        return jr({
          ok: false,
          error: "album_multiple_tracks",
          message: "Este álbum tem mais de uma faixa. Escolha qual cadastrar.",
          spotify_album_id: resolved.id,
          album_name: alb.album_name,
          album_tracks: alb.tracks.map((t) => ({
            spotify_track_id: t.id,
            track_name: t.name,
            artist_name: t.artists.join(", "),
          })),
        }, 200);
      }
    }

    // Fase 17-C — EXCEÇÃO documentada: cadastro manual user-driven faz
    // hidratação síncrona em cache miss (1 fetch via gateway + upsert).
    // Worker e processos automáticos continuam 100% cache-first.
    const hydrate = await hydrateTrackSync(trackId, "resolve-catalog-track");

    if (!hydrate.ok) {
      return jr({
        ok: false,
        error: hydrate.error,
        spotify_track_id: trackId,
        details: hydrate.details ?? null,
      }, hydrate.status === 404 ? 404 : hydrate.status >= 500 ? 502 : hydrate.status);
    }
    const trackRow = hydrate.row;

    const trackRaw = (trackRow.raw ?? {}) as {
      uri?: string;
      album?: { images?: Array<{ url: string }> };
      artists?: Array<{ id: string; name: string }>;
    };

    // Artistas: nomes vêm de `raw` ou (fallback) do artist_cache em batch.
    let trackArtists: Array<{ id: string; name: string }> =
      Array.isArray(trackRaw.artists) && trackRaw.artists.length > 0 && trackRaw.artists[0]?.name
        ? trackRaw.artists
        : [];
    if (trackArtists.length === 0 && Array.isArray(trackRow.artist_ids) && trackRow.artist_ids.length > 0) {
      const artCache = await getArtistCacheBatch(trackRow.artist_ids);
      trackArtists = trackRow.artist_ids.map((aid) => ({
        id: aid,
        name: artCache.get(aid)?.name ?? "",
      }));
    }

    // Detecção de gênero: lê genres do artist cache (primeiro artista).
    let artistGenres: string[] = [];
    let artistFollowers: number | null = null;
    const primaryArtistId = trackArtists[0]?.id ?? trackRow.artist_ids?.[0] ?? null;
    if (primaryArtistId) {
      const artCache = await getArtistCacheBatch([primaryArtistId]);
      const artRow = artCache.get(primaryArtistId);
      if (artRow && artRow.fetch_status === "ok") {
        artistGenres = Array.isArray(artRow.genres) ? artRow.genres : [];
        artistFollowers = typeof artRow.followers === "number" ? artRow.followers : null;
      }
    }

    // Shape compatível com o código a seguir.
    const track = {
      id: trackId,
      uri: trackRaw.uri ?? `spotify:track:${trackId}`,
      name: trackRow.name ?? "",
      popularity: typeof trackRow.popularity === "number" ? trackRow.popularity : undefined,
      external_ids: { isrc: trackRow.isrc ?? undefined },
      artists: trackArtists,
      album: { images: trackRaw.album?.images ?? [] },
    };

    // Detecção: cruza todos os artist.genres[] com genre_aliases
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const normalized = Array.from(new Set(artistGenres.map(normalizeSpotifyGenre).filter(Boolean)));

    type Hit = { alias: string; genre_id: string; genre_name: string };
    let hits: Hit[] = [];
    if (normalized.length > 0) {
      const { data: aliases } = await sb
        .from("genre_aliases")
        .select("alias, genre_id, genres:genre_id(nome)")
        .in("alias", normalized);
      hits = (aliases ?? []).map((r: any) => ({
        alias: r.alias,
        genre_id: r.genre_id,
        genre_name: r.genres?.nome ?? "",
      }));
    }

    // Conta ocorrências por genre_id pra ranquear o sugerido
    const counts = new Map<string, { genre_id: string; genre_name: string; count: number; aliases: string[] }>();
    for (const h of hits) {
      const cur = counts.get(h.genre_id) ?? { genre_id: h.genre_id, genre_name: h.genre_name, count: 0, aliases: [] };
      cur.count += 1;
      cur.aliases.push(h.alias);
      counts.set(h.genre_id, cur);
    }
    const ranked = [...counts.values()].sort((a, b) => b.count - a.count);
    const suggested = ranked[0] ?? null;
    const others = ranked.slice(1);

    // Verifica se já existe no catálogo
    const { data: existing } = await sb
      .from("catalog_tracks")
      .select("id, genre_id, status, added_at, genres:genre_id(nome)")
      .eq("spotify_track_id", trackId)
      .maybeSingle();

    return jr({
      ok: true,
      track: {
        spotify_track_id: track.id,
        spotify_uri: track.uri ?? `spotify:track:${track.id}`,
        track_name: track.name,
        artist_name: joinArtists(track.artists),
        isrc: track.external_ids?.isrc ?? null,
        cover_url: track.album?.images?.[0]?.url ?? null,
        popularity: typeof track.popularity === "number" ? track.popularity : null,
        artist_followers: artistFollowers,
      },
      spotify_genres_raw: artistGenres,
      spotify_genres_normalized: normalized,
      detected: {
        suggested_genre_id: suggested?.genre_id ?? null,
        suggested_genre_name: suggested?.genre_name ?? null,
        other_matches: others.map((o) => ({ genre_id: o.genre_id, genre_name: o.genre_name, matched_aliases: o.aliases })),
        all_matches: ranked.map((r) => ({ genre_id: r.genre_id, genre_name: r.genre_name, matched_aliases: r.aliases })),
      },
      existing: existing ? {
        catalog_track_id: existing.id,
        current_genre_id: existing.genre_id,
        current_genre_name: (existing as any).genres?.nome ?? null,
        status: existing.status,
        added_at: existing.added_at,
      } : null,
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    if (msg.startsWith("SPOTIFY_CIRCUIT_OPEN")) {
      // Match: SPOTIFY_CIRCUIT_OPEN: blocked_until=... retry_after=...s
      const blockedMatch = msg.match(/blocked_until=([^\s]+)/);
      const retryMatch = msg.match(/retry_after=(\d+)/);
      return jr({
        ok: false,
        error: "spotify_circuit_open",
        fallback: true,
        message: "Spotify temporariamente bloqueado (circuit breaker aberto). Tente novamente mais tarde.",
        blocked_until: blockedMatch?.[1] ?? null,
        retry_after_seconds: retryMatch ? Number(retryMatch[1]) : null,
      }, 200);
    }
    return jr({ ok: false, error: "internal_error", message: msg }, 500);
  }
});
