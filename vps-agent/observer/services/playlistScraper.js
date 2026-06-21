/**
 * Phase 17-C — Observer / Spotify Pathfinder scraper
 * ---------------------------------------------------
 * Substitui completamente o scraping de DOM.
 * Fonte única de dados: resposta da API interna
 *   https://api-partner.spotify.com/pathfinder/v2/query
 * cujo corpo contém `data.playlistV2.content.items[]`.
 *
 * Exporta `getPlaylist(playlistId)`, compatível com o server.js do Observer.
 * A função abre uma nova page via browser.js e retorna a estrutura normalizada
 * de uma playlist pública.
 *
 * Não faz fallback para DOM — se o Pathfinder não responder dentro
 * do timeout, a função lança erro e o caller decide o que fazer
 * (retry, marcar 502, etc).
 */

import { getBrowser } from './browser.js';

const PATHFINDER_HOST = 'api-partner.spotify.com';
const PATHFINDER_PATH = '/pathfinder/v2/query';
const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * @param {import('playwright').Page} page
 * @param {string} playlistId  Spotify playlist id (base62, sem prefixo).
 * @param {{ timeoutMs?: number, waitForIdleMs?: number }} [opts]
 * @returns {Promise<{
 *   playlist_id: string,
 *   uri: string,
 *   name: string|null,
 *   description: string|null,
 *   owner: { uri: string|null, name: string|null }|null,
 *   followers: number|null,
 *   images: Array<{ url: string, width: number|null, height: number|null }>,
 *   total_tracks: number|null,
 *   tracks: Array<NormalizedTrack>,
 *   raw_pathfinder_operation: string|null,
 *   captured_at: string
 * }>}
 */
export async function getPlaylist(playlistId, opts = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    return await scrapePlaylist(page, playlistId, opts);
  } finally {
    await page.close();
  }
}

export async function scrapePlaylist(page, playlistId, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!playlistId || typeof playlistId !== 'string') {
    throw new Error('scrapePlaylist: playlistId is required');
  }

  // 1. Registra listener ANTES da navegação para não perder a resposta.
  const pathfinderBodies = [];
  const onResponse = async (response) => {
    try {
      const url = response.url();
      if (!url.includes(PATHFINDER_HOST)) return;
      if (!url.includes(PATHFINDER_PATH)) return;

      const status = response.status();
      if (status < 200 || status >= 300) return;

      // Algumas respostas do Pathfinder não são JSON (ex: 204). Protege.
      const ctype = (response.headers()['content-type'] || '').toLowerCase();
      if (!ctype.includes('application/json')) return;

      const json = await response.json().catch(() => null);
      if (!json) return;

      // O Pathfinder usa múltiplas operações (fetchPlaylist, fetchPlaylistContents,
      // home, etc). Só nos interessa a que carrega `data.playlistV2`.
      const pv2 = json?.data?.playlistV2;
      if (!pv2) return;

      // Operation name vem no querystring (?operationName=fetchPlaylist…)
      let operationName = null;
      try {
        const u = new URL(url);
        operationName = u.searchParams.get('operationName');
      } catch (_) { /* noop */ }

      pathfinderBodies.push({ operationName, body: json });
    } catch (_) {
      // Silencia — nunca queremos derrubar o scraper por um listener.
    }
  };
  page.on('response', onResponse);

  let navigationError = null;
  try {
    // 2. Navega para a página pública da playlist.
    const url = `https://open.spotify.com/playlist/${encodeURIComponent(playlistId)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    // 3. Espera explicitamente por uma resposta Pathfinder com `playlistV2`.
    //    `waitForResponse` é mais robusto que `setTimeout` pois resolve assim
    //    que o predicate bate.
    await page.waitForResponse(async (response) => {
      try {
        const u = response.url();
        if (!u.includes(PATHFINDER_HOST) || !u.includes(PATHFINDER_PATH)) return false;
        if (response.status() !== 200) return false;
        const ctype = (response.headers()['content-type'] || '').toLowerCase();
        if (!ctype.includes('application/json')) return false;
        const json = await response.json().catch(() => null);
        return Boolean(json?.data?.playlistV2);
      } catch (_) {
        return false;
      }
    }, { timeout: timeoutMs });

    // Pequena folga para capturar respostas adicionais (paginação inicial
    // costuma vir em 1-2 chamadas seguidas para `fetchPlaylistContents`).
    if (opts.waitForIdleMs) {
      await page.waitForTimeout(opts.waitForIdleMs);
    } else {
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    }
  } catch (err) {
    navigationError = err;
  } finally {
    page.off('response', onResponse);
  }

  if (pathfinderBodies.length === 0) {
    const reason = navigationError ? ` (${navigationError.message})` : '';
    throw new Error(`Pathfinder response with playlistV2 not captured for ${playlistId}${reason}`);
  }

  // 4. Escolhe a melhor resposta: prioriza a que tem mais items capturados
  //    e cujo `playlistV2.uri` bate com o playlistId pedido.
  const best = pickBestPathfinderBody(pathfinderBodies, playlistId);
  if (!best) {
    throw new Error(`No Pathfinder body matched playlist ${playlistId}`);
  }

  // 5. Normaliza e retorna.
  return normalizePlaylist(best.body, playlistId, best.operationName);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickBestPathfinderBody(candidates, playlistId) {
  let best = null;
  let bestScore = -1;
  for (const c of candidates) {
    const pv2 = c.body?.data?.playlistV2;
    if (!pv2) continue;
    const items = pv2?.content?.items;
    const itemCount = Array.isArray(items) ? items.length : 0;
    const uriMatches = typeof pv2?.uri === 'string'
      && pv2.uri.endsWith(`:${playlistId}`);
    // Score: 1000 pontos por uri bater + 1 por item capturado.
    const score = (uriMatches ? 1000 : 0) + itemCount;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function normalizePlaylist(body, playlistId, operationName) {
  const pv2 = body?.data?.playlistV2 ?? {};
  const items = Array.isArray(pv2?.content?.items) ? pv2.content.items : [];

  const tracks = items
    .map((item, idx) => normalizeTrack(item, idx))
    .filter(Boolean);

  return {
    playlist_id: playlistId,
    uri: typeof pv2.uri === 'string' ? pv2.uri : `spotify:playlist:${playlistId}`,
    name: pickString(pv2.name),
    description: pickString(pv2.description),
    owner: normalizeOwner(pv2.ownerV2 ?? pv2.owner),
    followers: pickNumber(pv2?.followers ?? pv2?.followerCount),
    images: normalizeImages(pv2?.images?.items ?? pv2?.images ?? []),
    total_tracks: pickNumber(pv2?.content?.totalCount),
    tracks,
    raw_pathfinder_operation: operationName,
    captured_at: new Date().toISOString(),
  };
}

function normalizeTrack(item, idx) {
  // Pathfinder usa `itemV2.data` como source-of-truth para a faixa.
  const v2 = item?.itemV2?.data ?? null;
  if (!v2) return null;

  const uri = pickString(v2.uri) ?? null;
  const trackId = uri && uri.startsWith('spotify:track:') ? uri.slice('spotify:track:'.length) : null;

  const album = v2.albumOfTrack ?? null;
  const albumUri = pickString(album?.uri) ?? null;
  const albumCover = pickAlbumCover(album?.coverArt?.sources ?? album?.coverArt ?? null);

  const artistsItems = Array.isArray(album?.artists?.items)
    ? album.artists.items
    : Array.isArray(v2?.artists?.items)
      ? v2.artists.items
      : [];

  const artists = artistsItems.map((a) => ({
    name: pickString(a?.profile?.name) ?? pickString(a?.name) ?? null,
    uri: pickString(a?.uri) ?? null,
  })).filter((a) => a.name || a.uri);

  return {
    position: typeof item?.uid === 'string' ? idx + 1 : idx + 1,
    track_id: trackId,
    uri,
    name: pickString(v2.name) ?? null,
    playcount: pickNumber(v2.playcount),
    duration_ms: pickNumber(v2?.trackDuration?.totalMilliseconds),
    explicit: deriveExplicit(v2?.contentRating),
    album: {
      name: pickString(album?.name) ?? null,
      uri: albumUri,
      cover: albumCover,
    },
    artists,
  };
}

function normalizeOwner(owner) {
  if (!owner || typeof owner !== 'object') return null;
  return {
    uri: pickString(owner.uri) ?? null,
    name: pickString(owner?.data?.name) ?? pickString(owner?.name) ?? pickString(owner?.username) ?? null,
  };
}

function normalizeImages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const entry of list) {
    // Pode vir como { sources: [...] } ou já como source.
    const sources = Array.isArray(entry?.sources) ? entry.sources : [entry];
    for (const s of sources) {
      const url = pickString(s?.url);
      if (!url) continue;
      out.push({
        url,
        width: pickNumber(s?.width),
        height: pickNumber(s?.height),
      });
    }
  }
  return out;
}

function pickAlbumCover(sources) {
  if (!sources) return null;
  const list = Array.isArray(sources) ? sources : Array.isArray(sources?.sources) ? sources.sources : [];
  if (list.length === 0) return null;
  // Preferimos a maior, mas se não houver width usamos a primeira.
  let best = null;
  for (const s of list) {
    const url = pickString(s?.url);
    if (!url) continue;
    if (!best) { best = s; continue; }
    const sw = pickNumber(s?.width) ?? 0;
    const bw = pickNumber(best?.width) ?? 0;
    if (sw > bw) best = s;
  }
  return best ? pickString(best.url) ?? null : null;
}

function deriveExplicit(contentRating) {
  if (!contentRating) return null;
  const label = pickString(contentRating?.label);
  if (!label) return null;
  return label.toUpperCase() === 'EXPLICIT';
}

function pickString(v) {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function pickNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
