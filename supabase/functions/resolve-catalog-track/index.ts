// resolve-catalog-track — Etapa 1 do fluxo de catálogo.
// Recebe URL/URI/Track ID, resolve a faixa no Spotify e devolve metadados
// + detecção de gênero (cruzando artist.genres[] com genre_aliases).
// Sem efeitos colaterais. Idempotente.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAppToken, spotifyFetch } from "../_shared/spotify-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const TRACK_ID_RE = /^[A-Za-z0-9]{22}$/;
const URL_RE = /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})/i;
const URI_RE = /^spotify:track:([A-Za-z0-9]{22})$/i;

function resolveTrackId(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (TRACK_ID_RE.test(s)) return s;
  const uri = s.match(URI_RE);
  if (uri) return uri[1];
  const url = s.match(URL_RE);
  if (url) return url[1];
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

    const trackId = resolveTrackId(inputRaw);
    if (!trackId) {
      return jr({
        ok: false, error: "invalid_input",
        message: "Envie um Spotify track ID (22 chars), URI (spotify:track:...) ou URL (open.spotify.com/track/...).",
      }, 400);
    }

    const token = await getAppToken();
    const trackResp = await spotifyFetch(
      `https://api.spotify.com/v1/tracks/${trackId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!trackResp.ok) {
      const text = await trackResp.text();
      return jr({
        ok: false, error: "spotify_track_lookup_failed",
        status: trackResp.status, details: text.slice(0, 300),
      }, trackResp.status === 404 ? 404 : 502);
    }
    const track = await trackResp.json() as {
      id: string; uri: string; name: string;
      popularity?: number;
      external_ids?: { isrc?: string };
      artists: Array<{ id: string; name: string }>;
      album?: { images?: Array<{ url: string }> };
    };

    let artistGenres: string[] = [];
    let artistFollowers: number | null = null;
    const primaryArtistId = track.artists?.[0]?.id;
    if (primaryArtistId) {
      try {
        const artResp = await spotifyFetch(
          `https://api.spotify.com/v1/artists/${primaryArtistId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (artResp.ok) {
          const a = await artResp.json() as {
            followers?: { total?: number }; genres?: string[];
          };
          artistGenres = Array.isArray(a?.genres) ? a.genres : [];
          artistFollowers = a?.followers?.total ?? null;
        } else {
          await artResp.text();
        }
      } catch { /* ok */ }
    }

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
    return jr({ ok: false, error: "internal_error", message: (e as Error)?.message ?? String(e) }, 500);
  }
});
