// distribute-catalog-track — Entrada operacional da esteira de catálogo.
//
// Fluxo automático:
//   1. Recebe URL, URI ou Spotify Track ID em `input` (ou direto `spotify_track_id`).
//   2. Resolve a faixa no Spotify (/v1/tracks/{id}) e o artista principal (/v1/artists/{id})
//      pra capturar baseline T0 (popularity + monthly listeners não disponível via API,
//      mas followers do artista ficam no raw_payload pra auditoria).
//   3. Invoca a RPC `distribute_catalog_track()` que executa toda a lógica atômica:
//      find_or_create, baseline, cálculo de elegíveis, batch + placements.
//   4. Devolve o resumo operacional completo da execução.
//
// Regras (todas garantidas no banco, não aqui):
//   - Música nunca duplicada (UNIQUE em spotify_track_id).
//   - Placement nunca duplicado vivo (UNIQUE parcial em placements).
//   - Baseline T0 único por música (UNIQUE em catalog_track_baselines).
//
// Esta função NÃO aplica filtros de score/followers/performance/elegibilidade.
// As únicas barreiras pra distribuição são capacidade e duplicidade.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getArtistCacheBatch, hydrateTrackSync } from "../_shared/spotify-cache.ts";

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
  const s = input.trim();
  if (!s) return null;
  if (TRACK_ID_RE.test(s)) return s;
  const uri = s.match(URI_RE);
  if (uri) return uri[1];
  const url = s.match(URL_RE);
  if (url) return url[1];
  return null;
}

// Junta artistas no formato "Artist1, Artist2, ..." — o primeiro é o principal
// (Spotify devolve artists[] já em ordem). Mesmo padrão usado em outras
// funções da casa pra preservar features.
function joinArtists(artists: Array<{ name: string }>): string {
  return artists.map((a) => a.name).filter(Boolean).join(", ");
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
    const genreId = typeof body?.genre_id === "string" ? body.genre_id.trim() : "";

    const trackId = resolveTrackId(inputRaw);
    if (!trackId) {
      return jr({
        ok: false,
        error: "invalid_input",
        message: "Envie um Spotify track ID (22 chars), URI (spotify:track:...) ou URL (open.spotify.com/track/...).",
      }, 400);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(genreId)) {
      return jr({ ok: false, error: "invalid_genre_id", message: "genre_id (uuid) é obrigatório." }, 400);
    }

    // Auth: capturamos o user pra preencher `added_by` (best-effort).
    let addedBy: string | null = null;
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      try {
        const anon = createClient(
          SUPABASE_URL,
          Deno.env.get("SUPABASE_ANON_KEY") ?? "",
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data } = await anon.auth.getUser();
        addedBy = data?.user?.id ?? null;
      } catch { /* segue sem added_by */ }
    }

    // 1) Resolve a faixa via CACHE (Fase 17-C: spotify_track_cache).
    //    EXCEÇÃO documentada: cadastro manual user-driven faz hidratação
    //    síncrona em cache miss (1 fetch via gateway). Worker e processos
    //    automáticos continuam 100% cache-first.
    const hydrate = await hydrateTrackSync(trackId, "distribute-catalog-track");
    if (!hydrate.ok) {
      return jr({
        ok: false,
        error: hydrate.error,
        spotify_track_id: trackId,
        details: hydrate.details ?? null,
      }, hydrate.status === 404 ? 404 : hydrate.status >= 500 ? 502 : hydrate.status);
    }
    const trackRow = hydrate.row;

    // `raw` carrega o payload completo (album.images, artists[].name, etc.).
    const raw = (trackRow.raw ?? {}) as {
      uri?: string;
      album?: { images?: Array<{ url: string }> };
      artists?: Array<{ id: string; name: string }>;
    };
    // Se `raw` não tiver artist names, busca no artist cache.
    let trackArtists: Array<{ id: string; name: string }> =
      Array.isArray(raw.artists) && raw.artists.length > 0 && raw.artists[0]?.name
        ? raw.artists
        : [];
    if (trackArtists.length === 0 && Array.isArray(trackRow.artist_ids) && trackRow.artist_ids.length > 0) {
      const artCache = await getArtistCacheBatch(trackRow.artist_ids);
      trackArtists = trackRow.artist_ids.map((aid) => ({
        id: aid,
        name: artCache.get(aid)?.name ?? "",
      }));
    }
    const trackName = trackRow.name ?? "";
    const artistName = joinArtists(trackArtists);
    const isrc = trackRow.isrc ?? null;
    const spotifyUri = raw.uri ?? `spotify:track:${trackId}`;
    const coverUrl = raw?.album?.images?.[0]?.url ?? null;
    // IMPORTANTE: NÃO usamos popularity/monthly_listeners da cache como baseline.
    // A baseline T0 vem 100% do bot (Spotify for Artists), mesmo padrão dos deal_songs.
    const primaryArtistId = trackArtists[0]?.id ?? trackRow.artist_ids?.[0] ?? null;

    const baselineRaw = {
      track_cache: { id: trackId, name: trackRow.name, isrc, enriched_at: trackRow.enriched_at },
      captured_at: new Date().toISOString(),
      note: "baseline-empty-awaiting-bot",
    };

    // 3) Invoca a RPC atômica — baseline vai vazia (será preenchida pelo bot).
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: rpcData, error: rpcErr } = await sb.rpc("distribute_catalog_track", {
      p_spotify_track_id: trackId,
      p_genre_id: genreId,
      p_spotify_uri: spotifyUri,
      p_isrc: isrc,
      p_track_name: trackName,
      p_artist_name: artistName,
      p_cover_url: coverUrl,
      p_baseline_popularity: null,
      p_baseline_monthly_listeners: null,
      p_baseline_streams: null,
      p_baseline_raw: baselineRaw,
      p_added_by: addedBy,
    });

    // Persiste spotify_artist_id (necessário pro bot montar a URL S4A na próxima coleta)
    if (primaryArtistId) {
      try {
        await sb
          .from("catalog_tracks")
          .update({ spotify_artist_id: primaryArtistId })
          .eq("spotify_track_id", trackId)
          .is("spotify_artist_id", null);
      } catch { /* best effort */ }
    }

    if (rpcErr) {
      return jr({
        ok: false,
        error: "rpc_failed",
        message: rpcErr.message,
        details: rpcErr,
      }, 500);
    }

    return jr(rpcData);
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    return jr({ ok: false, error: "internal_error", message: msg }, 500);
  }
});
