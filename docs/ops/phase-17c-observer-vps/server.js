/**
 * Phase 17-E — Observer server.js
 * --------------------------------------------------------------------------
 * Node 18 ESM, ZERO external dependencies (only `http` + project modules).
 *
 * Endpoints:
 *   GET /health
 *   GET /playlists/:id
 *   GET /playlists/:id/items?offset&limit&max_age
 *
 * Auth (optional — loopback always bypasses):
 *   x-ops-agent-token   == env OPS_AGENT_TOKEN
 *   x-bot-ingest-token  == env BOT_INGEST_TOKEN
 *   x-api-key           == env BOT_API_KEY
 *   x-observer-token    == env OBSERVER_TOKEN
 *   If none of those envs are set, the server runs open (dev mode).
 *
 * Cache: in-memory by playlist_id, TTL = ?max_age seconds (default 600).
 * Same cached payload feeds both /playlists/:id and /playlists/:id/items.
 *
 * Does NOT modify services/playlistScraper.js or services/browser.js.
 */

import http from 'http';
import { URL } from 'url';
import { getPlaylist } from './services/playlistScraper.js';

const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_MAX_AGE_SECONDS = 600;

// --------------------------------------------------------------------------
// Auth
// --------------------------------------------------------------------------
const AUTH_MAP = [
  ['x-ops-agent-token',  process.env.OPS_AGENT_TOKEN],
  ['x-bot-ingest-token', process.env.BOT_INGEST_TOKEN],
  ['x-api-key',          process.env.BOT_API_KEY],
  ['x-observer-token',   process.env.OBSERVER_TOKEN],
].filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
 .map(([h, v]) => [h, v.trim()]);

const AUTH_ENABLED = AUTH_MAP.length > 0;

function isLoopback(req) {
  const ip = String(req.socket?.remoteAddress || '').replace('::ffff:', '');
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip === '';
}

function isAuthorized(req) {
  if (!AUTH_ENABLED) return true;
  if (isLoopback(req)) return true;
  for (const [header, expected] of AUTH_MAP) {
    const got = req.headers[header];
    if (typeof got === 'string' && got.trim() === expected) return true;
  }
  return false;
}

// --------------------------------------------------------------------------
// Cache — LRU bounded by OBSERVER_CACHE_MAX, with periodic TTL sweep.
// Fix for Phase 17-E memory leak: unbounded Map causing OOM ~12-24h.
// --------------------------------------------------------------------------
const CACHE_MAX = Math.max(10, Number(process.env.OBSERVER_CACHE_MAX) || 200);
const CACHE_SWEEP_INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.OBSERVER_CACHE_SWEEP_MS) || 5 * 60_000,
);
const CACHE_SWEEP_TTL_MS = Math.max(
  60_000,
  Number(process.env.OBSERVER_CACHE_SWEEP_TTL_MS) || 30 * 60_000,
);

/** @type {Map<string, { fetched_at: number, data: any }>} Insertion order = LRU. */
const cache = new Map();

function cacheTouch(key, entry) {
  // Re-insert to move to the tail (most-recently used).
  cache.delete(key);
  cache.set(key, entry);
  // Evict oldest until under cap.
  while (cache.size > CACHE_MAX) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function cacheSweep() {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of cache) {
    if (now - entry.fetched_at > CACHE_SWEEP_TTL_MS) {
      cache.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[observer] cache sweep: removed=${removed} size=${cache.size}/${CACHE_MAX}`);
  }
}

const sweepTimer = setInterval(cacheSweep, CACHE_SWEEP_INTERVAL_MS);
if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

async function getPlaylistCached(playlistId, maxAgeSeconds) {
  const now = Date.now();
  const ttlMs = Math.max(0, Number(maxAgeSeconds) || 0) * 1000;
  const cached = cache.get(playlistId);
  if (cached && ttlMs > 0 && now - cached.fetched_at < ttlMs) {
    // LRU touch on hit.
    cache.delete(playlistId);
    cache.set(playlistId, cached);
    return { data: cached.data, source: 'cache' };
  }
  // Drop stale entry before refetch so we don't hold the old payload during the scrape.
  if (cached) cache.delete(playlistId);
  const data = await getPlaylist(playlistId);
  cacheTouch(playlistId, { fetched_at: now, data });
  return { data, source: 'fresh_scrape' };
}

// --------------------------------------------------------------------------
// Spotify URI helpers
// --------------------------------------------------------------------------
function idFromUri(uri, kind) {
  if (typeof uri !== 'string') return '';
  const prefix = `spotify:${kind}:`;
  return uri.startsWith(prefix) ? uri.slice(prefix.length) : '';
}

// --------------------------------------------------------------------------
// Transformers — preserve original fields, ADD the 17-C contract shape
// --------------------------------------------------------------------------
function toMeta(raw, source) {
  const ownerName = raw?.owner?.name ?? null;
  const ownerId   = idFromUri(raw?.owner?.uri, 'user');
  const followers = typeof raw?.followers === 'number' ? raw.followers : 0;
  const total     = typeof raw?.total_tracks === 'number'
    ? raw.total_tracks
    : (Array.isArray(raw?.tracks) ? raw.tracks.length : 0);
  const capturedAt = raw?.captured_at ?? new Date().toISOString();

  return {
    // ---- 17-C contract ---------------------------------------------------
    id: raw?.playlist_id ?? null,
    uri: raw?.uri ?? (raw?.playlist_id ? `spotify:playlist:${raw.playlist_id}` : null),
    name: raw?.name ?? '',
    description: raw?.description ?? '',
    snapshot_id: capturedAt,
    owner: {
      id: ownerId,
      display_name: ownerName,
    },
    followers: { total: followers },
    tracks: { total },
    images: Array.isArray(raw?.images) ? raw.images : [],
    observer: {
      captured_at: capturedAt,
      source,
    },

    // ---- Backwards-compatible legacy fields ------------------------------
    playlist_id: raw?.playlist_id ?? null,
    total_tracks: total,
    raw_pathfinder_operation: raw?.raw_pathfinder_operation ?? null,
    captured_at: capturedAt,
  };
}

function toItem(track, idx) {
  const trackId = track?.track_id ?? idFromUri(track?.uri, 'track');
  const albumId = idFromUri(track?.album?.uri, 'album');
  const artists = Array.isArray(track?.artists) ? track.artists : [];

  return {
    position: typeof track?.position === 'number' ? track.position : (idx + 1),
    added_at: '',
    track: {
      id: trackId || '',
      uri: track?.uri ?? '',
      name: track?.name ?? '',
      duration_ms: typeof track?.duration_ms === 'number' ? track.duration_ms : 0,
      explicit: typeof track?.explicit === 'boolean' ? track.explicit : false,
      artists: artists.map((a) => ({
        id: idFromUri(a?.uri, 'artist'),
        name: a?.name ?? '',
        uri: a?.uri ?? '',
      })),
      album: {
        id: albumId,
        name: track?.album?.name ?? '',
        uri: track?.album?.uri ?? '',
        cover: track?.album?.cover ?? null,
      },
    },

    // ---- Backwards-compatible legacy flat fields -------------------------
    track_id: trackId || '',
    uri: track?.uri ?? '',
    name: track?.name ?? '',
    duration_ms: typeof track?.duration_ms === 'number' ? track.duration_ms : 0,
    explicit: typeof track?.explicit === 'boolean' ? track.explicit : false,
    playcount: typeof track?.playcount === 'number' ? track.playcount : null,
    album_name: track?.album?.name ?? '',
    artist_names: artists.map((a) => a?.name ?? '').filter(Boolean),
  };
}

// --------------------------------------------------------------------------
// HTTP helpers
// --------------------------------------------------------------------------
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-observer-phase': '17-E',
  });
  res.end(body);
}

function parseIntSafe(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

// --------------------------------------------------------------------------
// Route handlers
// --------------------------------------------------------------------------
async function handleHealth(_req, res) {
  const mem = process.memoryUsage();
  sendJson(res, 200, {
    ok: true,
    service: 'observer',
    phase: '17-E',
    auth_enabled: AUTH_ENABLED,
    uptime_s: Math.round(process.uptime()),
    now: new Date().toISOString(),
    // Additive monitoring metadata (backward-compatible).
    cache: {
      size: cache.size,
      max: CACHE_MAX,
      sweep_interval_ms: CACHE_SWEEP_INTERVAL_MS,
      sweep_ttl_ms: CACHE_SWEEP_TTL_MS,
    },
    memory: {
      rss_mb: +(mem.rss / 1048576).toFixed(1),
      heap_used_mb: +(mem.heapUsed / 1048576).toFixed(1),
      heap_total_mb: +(mem.heapTotal / 1048576).toFixed(1),
    },
  });
}

async function handlePlaylistMeta(req, res, playlistId, query) {
  if (!playlistId) return sendJson(res, 400, { error: 'missing playlist id' });
  const maxAge = query.get('max_age') != null
    ? Number(query.get('max_age'))
    : DEFAULT_MAX_AGE_SECONDS;

  try {
    const { data, source } = await getPlaylistCached(playlistId, maxAge);
    return sendJson(res, 200, toMeta(data, source));
  } catch (err) {
    console.error('[observer] /playlists/:id failed', playlistId, err);
    return sendJson(res, 502, {
      error: 'scrape_failed',
      message: String(err?.message ?? err),
      playlist_id: playlistId,
    });
  }
}

async function handlePlaylistItems(req, res, playlistId, query) {
  if (!playlistId) return sendJson(res, 400, { error: 'missing playlist id' });

  const offset = Math.max(0, parseIntSafe(query.get('offset'), 0));
  const rawLimit = parseIntSafe(query.get('limit'), 50);
  const limit = Math.max(1, Math.min(500, rawLimit));
  const maxAge = query.get('max_age') != null
    ? Number(query.get('max_age'))
    : DEFAULT_MAX_AGE_SECONDS;

  try {
    const { data } = await getPlaylistCached(playlistId, maxAge);
    const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
    const total = typeof data?.total_tracks === 'number' ? data.total_tracks : tracks.length;

    const slice = tracks.slice(offset, offset + limit);
    const items = slice.map((t, i) => toItem(t, offset + i));

    const nextOffset = offset + items.length;
    let next = '';
    if (nextOffset < total && items.length > 0) {
      const params = new URLSearchParams({
        offset: String(nextOffset),
        limit: String(limit),
      });
      next = `/playlists/${encodeURIComponent(playlistId)}/items?${params.toString()}`;
    }

    return sendJson(res, 200, { items, total, limit, offset, next });
  } catch (err) {
    console.error('[observer] /playlists/:id/items failed', playlistId, err);
    return sendJson(res, 502, {
      error: 'scrape_failed',
      message: String(err?.message ?? err),
      playlist_id: playlistId,
    });
  }
}

// --------------------------------------------------------------------------
// Router
// --------------------------------------------------------------------------
const RE_PLAYLIST_ITEMS = /^\/playlists\/([^/]+)\/items\/?$/;
const RE_PLAYLIST_META  = /^\/playlists\/([^/]+)\/?$/;

async function router(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const query = url.searchParams;
  const method = (req.method || 'GET').toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  if (pathname === '/health' || pathname === '/health/') {
    return handleHealth(req, res);
  }

  // Auth gate for everything below /health
  if (!isAuthorized(req)) {
    return sendJson(res, 401, { error: 'unauthorized' });
  }

  let m;
  if ((m = pathname.match(RE_PLAYLIST_ITEMS))) {
    return handlePlaylistItems(req, res, decodeURIComponent(m[1]), query);
  }
  if ((m = pathname.match(RE_PLAYLIST_META))) {
    return handlePlaylistMeta(req, res, decodeURIComponent(m[1]), query);
  }

  return sendJson(res, 404, { error: 'not_found', path: pathname });
}

// --------------------------------------------------------------------------
// Server
// --------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  router(req, res).catch((err) => {
    console.error('[observer] unhandled error', err);
    try {
      sendJson(res, 500, { error: 'internal_error', message: String(err?.message ?? err) });
    } catch {
      try { res.end(); } catch {}
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[observer] listening on http://${HOST}:${PORT} (auth_enabled=${AUTH_ENABLED})`);
});
