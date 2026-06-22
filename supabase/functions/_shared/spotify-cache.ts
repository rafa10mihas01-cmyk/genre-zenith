// Spotify enrichment cache helper.
//
// Diagnose/scoring NUNCA chamam Spotify direto pra popularity/genres/followers.
// Tudo passa por aqui: lê do cache local (spotify_track_cache / spotify_artist_cache)
// e enfileira o que estiver faltando ou expirado em spotify_enrichment_queue.
//
// O worker (spotify-enrichment-worker) drena a fila de forma assíncrona usando
// /v1/tracks/{id} e /v1/artists/{id} (single-path), respeitando rate limit.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// TTLs (configuráveis via env vars; defaults conservadores).
function envDays(name: string, def: number): number {
  const v = Number(Deno.env.get(name));
  return Number.isFinite(v) && v > 0 ? v : def;
}
export const CACHE_TTL = {
  track_popularity_days: envDays("CACHE_TRACK_POP_TTL_DAYS", 14),
  artist_pop_days: envDays("CACHE_ARTIST_POP_TTL_DAYS", 14),
  artist_genres_days: envDays("CACHE_ARTIST_GENRES_TTL_DAYS", 90),
};
const DAY_MS = 86_400_000;

export type TrackCacheRow = {
  spotify_track_id: string;
  name: string | null;
  isrc: string | null;
  album_id: string | null;
  release_date: string | null;
  duration_ms: number | null;
  explicit: boolean | null;
  popularity: number | null;
  artist_ids: string[];
  popularity_refreshed_at: string | null;
  enriched_at: string | null;
  fetch_status: string;
  // Fase 17-C: `raw` é o payload Spotify completo. Consumidores que precisam de
  // album.name, album.images, artists[].name etc. leem daqui — não fazem fetch.
  raw: any | null;
};

export type ArtistCacheRow = {
  spotify_artist_id: string;
  name: string | null;
  genres: string[];
  popularity: number | null;
  followers: number | null;
  image_url: string | null;
  refreshed_at: string | null;
  genres_refreshed_at: string | null;
  enriched_at: string | null;
  fetch_status: string;
  raw: any | null;
};

function svc() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

function isStale(ts: string | null, days: number): boolean {
  if (!ts) return true;
  return Date.now() - new Date(ts).getTime() > days * DAY_MS;
}

/**
 * Lê tracks do cache (em lote). Retorna mapa por spotify_track_id.
 * Tracks ausentes e tracks com popularity stale são enfileiradas automaticamente
 * (não bloqueia: insert async, dedupado por unique parcial).
 */
export async function getTrackCacheBatch(ids: string[]): Promise<Map<string, TrackCacheRow>> {
  const out = new Map<string, TrackCacheRow>();
  if (ids.length === 0) return out;
  const sb = svc();
  const unique = Array.from(new Set(ids));
  // chunk pra evitar URL grande
  for (let i = 0; i < unique.length; i += 500) {
    const slice = unique.slice(i, i + 500);
    const { data } = await sb
      .from("spotify_track_cache")
      .select("spotify_track_id,name,isrc,album_id,release_date,duration_ms,explicit,popularity,artist_ids,popularity_refreshed_at,enriched_at,fetch_status,raw")
      .in("spotify_track_id", slice);
    for (const row of data ?? []) out.set((row as any).spotify_track_id, row as TrackCacheRow);
  }

  // Enqueue misses + stale (best-effort, não bloqueia leitura)
  const misses: string[] = [];
  const stales: string[] = [];
  for (const id of unique) {
    const r = out.get(id);
    if (!r) { misses.push(id); continue; }
    if (r.fetch_status === "ok" && isStale(r.popularity_refreshed_at, CACHE_TTL.track_popularity_days)) {
      stales.push(id);
    }
  }
  if (misses.length) enqueueEnrichment("track", misses, "diagnose_miss", 3).catch(() => {});
  if (stales.length) enqueueEnrichment("track", stales, "ttl_expired", 6).catch(() => {});
  return out;
}

export async function getArtistCacheBatch(ids: string[]): Promise<Map<string, ArtistCacheRow>> {
  const out = new Map<string, ArtistCacheRow>();
  if (ids.length === 0) return out;
  const sb = svc();
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += 500) {
    const slice = unique.slice(i, i + 500);
    const { data } = await sb
      .from("spotify_artist_cache")
      .select("spotify_artist_id,name,genres,popularity,followers,image_url,refreshed_at,genres_refreshed_at,enriched_at,fetch_status")
      .in("spotify_artist_id", slice);
    for (const row of data ?? []) out.set((row as any).spotify_artist_id, row as ArtistCacheRow);
  }
  const misses: string[] = [];
  const stales: string[] = [];
  for (const id of unique) {
    const r = out.get(id);
    if (!r) { misses.push(id); continue; }
    if (r.fetch_status === "ok" && isStale(r.refreshed_at, CACHE_TTL.artist_pop_days)) {
      stales.push(id);
    }
  }
  if (misses.length) enqueueEnrichment("artist", misses, "diagnose_miss", 3).catch(() => {});
  if (stales.length) enqueueEnrichment("artist", stales, "ttl_expired", 6).catch(() => {});
  return out;
}

/**
 * Enfileira IDs pra enriquecimento. Unique parcial em (kind, ref_id) WHERE status IN
 * ('pending','processing') garante dedupe. Usa upsert com ignoreDuplicates.
 */
export async function enqueueEnrichment(
  kind: "track" | "artist",
  ids: string[],
  reason: string = "new",
  priority: number = 5,
): Promise<void> {
  if (!ids.length) return;
  const sb = svc();
  const rows = Array.from(new Set(ids)).map((ref_id) => ({
    kind, ref_id, reason, priority, status: "pending",
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    // Não usamos upsert porque o unique é parcial; usamos insert e ignoramos
    // conflitos individuais via on_conflict do_nothing (postgrest: simplesmente
    // ignoramos erros 23505 — não tem maneira limpa via supabase-js, então
    // inserimos por chunks pequenos e descartamos o erro do chunk).
    const { error } = await sb.from("spotify_enrichment_queue").insert(slice);
    if (error && !/duplicate key/i.test(error.message)) {
      // log soft, não joga
      console.warn("[spotify-cache] enqueue warn:", error.message);
    }
  }
}
