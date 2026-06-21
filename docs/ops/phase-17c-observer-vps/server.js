/**
 * Phase 17-D — Observer server.js
 * --------------------------------------------------------------------------
 * Express server (Node 18 ESM) that exposes the Observer HTTP contract
 * required by the Lovable Cloud worker `revalidate-deliveries` and by the
 * validation script `scripts/phase17d-observer-compat.mjs`.
 *
 * Endpoints:
 *   GET /health
 *   GET /playlists/:id
 *   GET /playlists/:id/items
 *
 * Auth (optional — loopback bypasses):
 *   Header  x-ops-agent-token    matches env OPS_AGENT_TOKEN
 *   Header  x-bot-ingest-token   matches env BOT_INGEST_TOKEN
 *   Header  x-api-key            matches env BOT_API_KEY
 *   Header  x-observer-token     matches env OBSERVER_TOKEN
 *   If NONE of those envs are set, the server runs open (dev mode).
 *
 * Cache:
 *   In-memory by playlist_id, TTL = ?max_age seconds (default 600). The same
 *   cached payload feeds both /playlists/:id and /playlists/:id/items so the
 *   two endpoints stay consistent without re-scraping.
 *
 * IMPORTANT:
 *   - Does NOT modify services/playlistScraper.js
 *   - Does NOT modify services/browser.js
 *   - Reuses getPlaylist() exactly as exported by playlistScraper.js
 */

import express from 'express';
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
  const ip = (req.ip || req.connection?.remoteAddress || '').replace('::ffff:', '');
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function authMiddleware(req, res, next) {
  if (!AUTH_ENABLED) return next();
  if (isLoopback(req)) return next();
  for (const [header, expected] of AUTH_MAP) {
    const got = req.headers[header];
    if (typeof got === 'string' && got.trim() === expected) return next();
  }
  return res.status(401).json({ error: 'unauthorized' });
}

// --------------------------------------------------------------------------
// Cache
// --------------------------------------------------------------------------
/** @type {Map<string, { fetched_at: number, data: any }>} */
const cache = new Map();

async function getPlaylistCached(playlistId, maxAgeSeconds) {
  const now = Date.now();
  const ttlMs = Math.max(0, Number(maxAgeSeconds) || 0) * 1000;
  const cached = cache.get(playlistId);
  if (cached && ttlMs > 0 && now - cached.fetched_at < ttlMs) {
    return { data: cached.data, source: 'cache' };
  }
  const data = await getPlaylist(playlistId);
  cache.set(playlistId, { fetched_at: now, data });
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
// App
// --------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'observer',
    phase: '17-D',
    auth_enabled: AUTH_ENABLED,
    uptime_s: Math.round(process.uptime()),
    now: new Date().toISOString(),
  });
});

app.get('/playlists/:id', authMiddleware, async (req, res) => {
  const playlistId = String(req.params.id || '').trim();
  if (!playlistId) return res.status(400).json({ error: 'missing playlist id' });
  const maxAge = req.query.max_age != null
    ? Number(req.query.max_age)
    : DEFAULT_MAX_AGE_SECONDS;

  try {
    const { data, source } = await getPlaylistCached(playlistId, maxAge);
    return res.json(toMeta(data, source));
  } catch (err) {
    console.error('[observer] /playlists/:id failed', playlistId, err);
    return res.status(502).json({
      error: 'scrape_failed',
      message: String(err?.message ?? err),
      playlist_id: playlistId,
    });
  }
});

app.get('/playlists/:id/items', authMiddleware, async (req, res) => {
  const playlistId = String(req.params.id || '').trim();
  if (!playlistId) return res.status(400).json({ error: 'missing playlist id' });

  const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? '0'), 10) || 0);
  const rawLimit = Number.parseInt(String(req.query.limit ?? '50'), 10);
  const limit = Math.max(1, Math.min(500, Number.isFinite(rawLimit) ? rawLimit : 50));
  const maxAge = req.query.max_age != null
    ? Number(req.query.max_age)
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

    return res.json({
      items,
      total,
      limit,
      offset,
      next,
    });
  } catch (err) {
    console.error('[observer] /playlists/:id/items failed', playlistId, err);
    return res.status(502).json({
      error: 'scrape_failed',
      message: String(err?.message ?? err),
      playlist_id: playlistId,
    });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

app.listen(PORT, HOST, () => {
  console.log(`[observer] listening on http://${HOST}:${PORT} (auth_enabled=${AUTH_ENABLED})`);
});
