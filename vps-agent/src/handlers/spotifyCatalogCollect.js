// Job: spotify.catalog.collect — coleta breakdown de playlists para música do Catálogo.
// Mantém o contrato HTTP existente: POST em bot-ingest-song-snapshot com
// catalog_track_id + queue_id + playlists[]. Não altera Edge/Banco/Frontend.
import { browserPool } from "../playwright/browserPool.js";
import { assertLoggedIn } from "../playwright/spotifySession.js";
import { SELECTORS } from "../playwright/spotifySelectors.js";
import { uploadScreenshot } from "../cloud/uploadPrint.js";
import { insertBotEvent } from "../cloud/persistence.js";
import { config } from "../config.js";
import { makeLogger } from "../logger.js";

const log = makeLogger("h:catalog.collect");

// Mesmo seletor canônico usado por spotifyDealCollect.js — única fonte para a tabela
// de playlists do S4A. Fallbacks anteriores ([data-testid="row"], [role="row"],
// "tbody tr") foram REMOVIDOS porque capturavam linhas de header/skeleton e
// faziam o catalog devolver playlists=[] mesmo com a tabela populada.
const ROW_SEL = '[data-testid="sort-table-body-row"]';
const SCROLL_CONTAINER = '#chrome-v2-main-content-scroll-root';
const ROWS_PER_PRINT = 16;

function parsePlays(txt) {
  if (!txt) return null;
  const clean = String(txt).trim().toLowerCase().replace(/\u00a0/g, " ");
  const mult = clean.endsWith("m") ? 1_000_000 : clean.endsWith("k") ? 1_000 : 1;
  const numStr = clean
    .replace(/[^\d,.\-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const n = Number(numStr);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * mult);
}

function extractPlaylistId(href) {
  if (!href) return null;
  const m = String(href).match(/spotify:playlist:([a-zA-Z0-9]{15,})|playlist[/:]([a-zA-Z0-9]{15,})/);
  return m ? (m[1] || m[2]) : null;
}

function normalizeWhitespace(txt) {
  return String(txt ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function pickBestPlaysText(row) {
  const candidates = [
    row.plays_text,
    ...(Array.isArray(row.metric_text_candidates) ? row.metric_text_candidates : []),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (parsePlays(candidate) != null) return candidate;
  }

  return null;
}

async function applySevenDayFilter(page) {
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (/[Úú]ltimos 7 dias|last 7 days/i.test(bodyText) && !/[Úú]ltimos 28 dias|last 28 days/i.test(bodyText)) {
    return true;
  }

  const dropdownCandidates = [
    'button#dropdown-toggle',
    'button[aria-haspopup="listbox"]',
    'button[aria-haspopup="menu"]',
    '[role="button"][aria-haspopup="listbox"]',
    'button:has-text("Últimos")',
    'button:has-text("Last")',
    'button:has-text("28")',
    'button:has-text("7")',
  ];

  for (const selector of dropdownCandidates) {
    const dropdown = page.locator(selector).first();
    if ((await dropdown.count().catch(() => 0)) === 0) continue;

    try {
      await dropdown.click({ timeout: 3000 });
      await page.waitForTimeout(400);
      const option7d = page
        .locator('li, [role="option"], [role="menuitem"], button, a')
        .filter({ hasText: /[Úú]ltimos 7 dias|last 7 days|\b7 dias\b|\b7 days\b/i })
        .first();

      if ((await option7d.count().catch(() => 0)) > 0) {
        await option7d.click({ timeout: 3000 });
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1200);
        return true;
      }

      await page.keyboard.press("Escape").catch(() => {});
    } catch (e) {
      log.warn("falha tentando aplicar filtro 7d", { selector, err: String(e) });
      await page.keyboard.press("Escape").catch(() => {});
    }
  }

  return false;
}

function buildStatsUrl(payload) {
  const direct = payload?.s4a_song_url || payload?.song_s4a_url || payload?.url;
  if (typeof direct === "string" && direct.includes("artists.spotify.com")) {
    return direct.replace(/\/playlists(?:[?#].*)?$/, "/stats");
  }

  if (payload?.spotify_artist_id && payload?.spotify_track_id) {
    return `https://artists.spotify.com/c/pt/artist/${payload.spotify_artist_id}/song/${payload.spotify_track_id}/stats`;
  }

  return null;
}

async function readTotalPlays(page, statsUrl) {
  let total_plays_28d = null;
  let total_plays_7d = null;
  let filter_7d_applied = false;

  await page.goto(statsUrl, { waitUntil: "networkidle", timeout: 30000 });
  await assertLoggedIn(page);
  await page.locator(SELECTORS.printArea).first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return el && /\d/.test(el.textContent || "");
    },
    SELECTORS.songTotalStreams,
    { timeout: 8000 },
  ).catch(() => {});

  const txt28 = await page.locator(SELECTORS.songTotalStreams).first().innerText().catch(() => null);
  total_plays_28d = parsePlays(txt28);

  // Mesmo fluxo do deal: tenta selecionar "Últimos 7 dias" no header quando o S4A expõe o dropdown.
  filter_7d_applied = await applySevenDayFilter(page);
  if (filter_7d_applied) {
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        return el && /\d/.test(el.textContent || "");
      },
      SELECTORS.songTotalStreams,
      { timeout: 8000 },
    ).catch(() => {});
    const txt7 = await page.locator(SELECTORS.songTotalStreams).first().innerText().catch(() => null);
    total_plays_7d = parsePlays(txt7);
  }

  return { total_plays_28d, total_plays_7d, filter_7d_applied };
}

async function scrollPlaylistTable(page, stepPx) {
  const moved = await page.evaluate(({ containerSelector, step }) => {
    const container = document.querySelector(containerSelector);
    if (container) {
      const before = container.scrollTop;
      container.scrollBy({ top: step, behavior: "instant" });
      return container.scrollTop !== before;
    }
    const before = window.scrollY;
    window.scrollBy(0, step);
    return window.scrollY !== before;
  }, { containerSelector: SCROLL_CONTAINER, step: stepPx });

  await page.waitForTimeout(800);
  return moved;
}

async function isPlaylistTableAtBottom(page) {
  return await page.evaluate((containerSelector) => {
    const container = document.querySelector(containerSelector);
    if (container) return container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
    return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
  }, SCROLL_CONTAINER).catch(() => true);
}

async function extractVisiblePlaylistRows(page) {
  return await page.evaluate((rowSelector) => {
    const norm = (txt) => String(txt || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const pickPlaylistName = (row, cells, linkEl) => {
      const heading = row.querySelector('h1, h2, h3, [role="heading"]');
      const anchorText = norm(linkEl?.textContent);
      const cellTexts = cells.map((td) => norm(td.textContent)).filter(Boolean);
      const textCandidates = [norm(heading?.textContent), anchorText, ...cellTexts];

      for (const txt of textCandidates) {
        if (!txt) continue;
        if (/^#?$|playlist|streams?|ouvintes?|listeners?|plays?|reprodu/i.test(txt)) continue;
        if (/^[\d.,\s]+[km]?$/i.test(txt)) continue;
        return txt;
      }
      return null;
    };

    const result = [];
    document.querySelectorAll(rowSelector).forEach((row) => {
      const ariaLabel = row.getAttribute("aria-label") || "";
      const linkEl = row.querySelector('a[href*="playlist"], a[href*="open.spotify.com/playlist"]');
      const href = linkEl?.href || linkEl?.getAttribute("href") || null;
      const idSource = `${ariaLabel} ${href || ""}`;
      const idMatch = idSource.match(/spotify:playlist:([a-zA-Z0-9]{15,})|playlist[/:]([a-zA-Z0-9]{15,})/);
      const playlistId = idMatch ? (idMatch[1] || idMatch[2]) : null;
      const cells = Array.from(row.querySelectorAll('td, [role="cell"], [role="gridcell"]'));
      const playlist_name = pickPlaylistName(row, cells, linkEl);
      if (!playlistId && !playlist_name) return;

      const nameCell = cells.find((td) => {
        const txt = norm(td.textContent);
        return playlist_name && txt.includes(playlist_name);
      }) || cells[1] || row;
      const ownerCandidates = Array.from(nameCell.querySelectorAll("p, span, small"))
        .map((el) => norm(el.textContent))
        .filter((txt) => txt && txt !== playlist_name && !/^[\d.,\s]+[km]?$/i.test(txt));
      const owner = ownerCandidates[1] || ownerCandidates[0] || null;
      const metric_text_candidates = [
        ...cells.slice(2).map((td) => norm(td.textContent)),
        ...Array.from(row.querySelectorAll("span, div, p")).map((el) => norm(el.textContent)).filter((txt) => txt.length <= 24),
      ].filter(Boolean);
      const playsText = metric_text_candidates.find((txt) => /\d/.test(txt) && /^[\d.,\s]+[km]?$/i.test(txt)) || null;
      result.push({ href, playlistId, playlist_name, owner, plays_text: playsText, metric_text_candidates });
    });
    return result;
  }, ROW_SEL);
}

async function scrapePlaylistBreakdown(page, statsUrl) {
  const totals = await readTotalPlays(page, statsUrl);

  const playlistsUrl = statsUrl.replace("/stats", "/playlists");
  log.info("navegando para playlists", { url: playlistsUrl });
  await page.goto(playlistsUrl, { waitUntil: "networkidle", timeout: 30000 });
  await assertLoggedIn(page);
  await page.locator(SELECTORS.printArea).first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(2000);
  const playlist_filter_7d_applied = await applySevenDayFilter(page);

  try {
    await page.locator(ROW_SEL).first().waitFor({ state: "visible", timeout: 10000 });
  } catch {
    log.warn("tabela de playlists nao renderizou em 10s", {});
  }

  const playlists = [];
  const seen = new Set();
  let passesWithoutNew = 0;
  let scroll_passes = 0;

  while (passesWithoutNew < 3 && scroll_passes < 80) {
    scroll_passes++;
    const rows = await extractVisiblePlaylistRows(page);
    let newFound = 0;

    for (const row of rows) {
      const id = row.playlistId || extractPlaylistId(row.href);
      const key = id || (row.playlist_name || "").toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      newFound++;

      playlists.push({
        spotify_playlist_id: id || null,
        spotify_url: id ? (row.href || `https://open.spotify.com/playlist/${id}`) : null,
        name: row.playlist_name || null,
        owner: row.owner || null,
        plays_7d: parsePlays(pickBestPlaysText(row)) ?? null,
      });
    }

    if (newFound === 0) passesWithoutNew++;
    else passesWithoutNew = 0;

    if (await isPlaylistTableAtBottom(page)) break;
    const moved = await scrollPlaylistTable(page, 600);
    if (!moved) break;
  }

  log.info("playlists capturadas", { rows_captured: playlists.length, scroll_passes });

  return {
    ...totals,
    playlists,
    rows_captured: playlists.length,
    scroll_passes,
    playlist_filter_7d_applied,
  };
}

async function capturePlaylistPrints(page, { catalog_track_id, correlation_id, playlists }) {
  const screenshot_buffers = [];

  try {
    const container = page.locator(SCROLL_CONTAINER).first();
    const hasContainer = await container.count().catch(() => 0);
    if (hasContainer > 0) {
      await container.evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
    } else {
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await page.waitForTimeout(500);

    const rowH = await page.evaluate((sel) => {
      const r = document.querySelector(sel);
      return r ? Math.round(r.getBoundingClientRect().height) : 56;
    }, ROW_SEL).catch(() => 56);
    const shotH = Math.max(320, rowH * ROWS_PER_PRINT);

    const totalNeeded = Math.max(1, Math.ceil((playlists.length || 1) / ROWS_PER_PRINT));
    const maxParts = Math.min(80, totalNeeded);
    const seenHashes = new Set();

    for (let partIndex = 0; partIndex < maxParts; partIndex++) {
      await page.waitForTimeout(400);

      const box = hasContainer > 0
        ? await container.boundingBox()
        : await page.locator(SELECTORS.printArea).first().boundingBox();
      if (!box) break;

      const firstTop = await page.evaluate(({ csel, rsel }) => {
        const cont = document.querySelector(csel);
        const cTop = cont ? cont.getBoundingClientRect().top : 0;
        const rows = Array.from(document.querySelectorAll(rsel));
        const first = rows.find((r) => r.getBoundingClientRect().bottom > cTop + 1);
        return first ? Math.round(first.getBoundingClientRect().top) : null;
      }, { csel: SCROLL_CONTAINER, rsel: ROW_SEL }).catch(() => null);

      const clipY = Math.max(0, firstTop ?? box.y);
      const clipH = Math.max(rowH, Math.min(shotH, Math.floor(box.y + box.height - clipY)));
      const buf = await page.screenshot({
        clip: { x: box.x, y: clipY, width: box.width, height: clipH },
        type: "png",
        animations: "disabled",
      });

      const visibleIds = await page.evaluate(({ rsel, top, bot }) => Array.from(document.querySelectorAll(rsel))
        .filter((r) => {
          const b = r.getBoundingClientRect();
          return b.top >= top - 2 && b.bottom <= bot + 2;
        })
        .map((r) => (r.getAttribute("aria-label") || r.textContent || "").slice(0, 80))
        .join("|"), { rsel: ROW_SEL, top: clipY, bot: clipY + clipH }).catch(() => "");

      const hash = visibleIds || `empty-${partIndex}`;
      if (!seenHashes.has(hash)) {
        seenHashes.add(hash);
        screenshot_buffers.push(buf);
      }

      if (await isPlaylistTableAtBottom(page)) break;
      const moved = await scrollPlaylistTable(page, shotH);
      if (!moved) break;
    }
  } catch (e) {
    log.warn("captura de prints falhou", { err: String(e) });
  }

  if (playlists.length > 30 && screenshot_buffers.length <= 1) {
    throw new Error(`multi_print_required: ${playlists.length} playlists exigem prints paginados; capturados=${screenshot_buffers.length}`);
  }

  const print_urls = [];
  const totalParts = screenshot_buffers.length;
  for (let i = 0; i < screenshot_buffers.length; i++) {
    const up = await uploadScreenshot(
      screenshot_buffers[i],
      `catalog/${catalog_track_id}/${correlation_id}-playlists-part-${i + 1}-of-${totalParts}.png`,
      {
        catalog_track_id,
        correlation_id,
        label: `catalog-playlists-part-${i + 1}-of-${totalParts}`,
        dom_playlists: i === 0 ? playlists.map((p) => ({
          spotify_playlist_id: p.spotify_playlist_id ?? null,
          spotify_url: p.spotify_url ?? null,
          playlist_name: p.name ?? null,
          plays_7d: p.plays_7d ?? null,
        })) : [],
      },
    );
    const url = up?.signed_url ?? up?.publicUrl ?? null;
    if (url) print_urls.push(url);
  }

  if (playlists.length > 30 && print_urls.length <= 1) {
    throw new Error(`multi_print_required: upload retornou ${print_urls.length} prints para ${playlists.length} playlists`);
  }

  return print_urls;
}

export async function spotifyCatalogCollect(job, ctx = {}) {
  const payload = job?.payload ?? job ?? {};
  const catalog_track_id = payload.catalog_track_id;
  const queue_id = payload.queue_id ?? payload.id ?? job?.id ?? null;
  const spotify_track_id = payload.spotify_track_id ?? payload.spotify_song_id ?? null;
  const correlation_id = payload.correlation_id ?? job?.id ?? queue_id;
  const statsUrl = buildStatsUrl(payload);

  if (!catalog_track_id || !spotify_track_id || !statsUrl) {
    const err = new Error("catalog_track_id, spotify_track_id e URL S4A obrigatórios");
    err.fatal = true;
    throw err;
  }

  const requiresBreakdown = payload.requires_playlist_breakdown === true
    || payload.capture_mode === "playlist_breakdown_required"
    || payload.ingest_contract === "send_playlist_rows_not_aggregate";

  const workerId = ctx.workerId ?? ctx.worker_id ?? payload.worker_id ?? null;
  const t0 = Date.now();

  try {
    log.info("modo playlist_breakdown catalog", { catalog_track_id, queue_id, spotify_track_id, url: statsUrl });

    const result = await browserPool.withPage(async (page) => scrapePlaylistBreakdown(page, statsUrl));

    if (requiresBreakdown && result.playlists.length === 0) {
      throw new Error("playlist_breakdown_required: catalog retornou playlists=[]; job deve retry/fail, não salvar sucesso vazio");
    }

    const print_urls = await browserPool.withPage(async (page) => {
      await page.goto(statsUrl.replace("/stats", "/playlists"), { waitUntil: "networkidle", timeout: 30000 });
      await assertLoggedIn(page);
      await page.locator(SELECTORS.printArea).first().waitFor({ state: "visible", timeout: 15000 });
      await applySevenDayFilter(page);
      await page.locator(ROW_SEL).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      return capturePlaylistPrints(page, { catalog_track_id, correlation_id, playlists: result.playlists });
    });

    const ingestPayload = {
      catalog_track_id,
      queue_id,
      spotify_track_id,
      spotify_song_id: spotify_track_id,
      correlation_id,
      captured_at: new Date().toISOString(),
      window: "7d",
      total_plays_28d: result.total_plays_28d ?? null,
      total_plays_7d: result.total_plays_7d ?? null,
      screenshot_url: print_urls[0] ?? null,
      print_urls,
      playlists: result.playlists
        .filter((p) => p.name && p.name.trim().length > 0)
        .map((p) => ({
          spotify_playlist_id: p.spotify_playlist_id ?? null,
          spotify_url: p.spotify_url ?? null,
          name: p.name.trim(),
          owner: p.owner ?? null,
          plays_7d: p.plays_7d ?? null,
        })),
      bot_metadata: {
        kind: "catalog",
        worker_id: workerId,
        queue_id,
        catalog_track_id,
        spotify_track_id,
        spotify_song_id: spotify_track_id,
        duration_ms: Date.now() - t0,
        attempts: job?.attempts ?? payload.attempts ?? 0,
        requires_playlist_breakdown: requiresBreakdown,
        capture_mode: payload.capture_mode ?? null,
        rows_captured: result.rows_captured,
        scroll_passes: result.scroll_passes,
        filter_7d_applied: result.filter_7d_applied || result.playlist_filter_7d_applied,
        stats_filter_7d_applied: result.filter_7d_applied,
        playlist_filter_7d_applied: result.playlist_filter_7d_applied,
        prints_captured: print_urls.length,
      },
    };

    if (requiresBreakdown && ingestPayload.playlists.length === 0) {
      throw new Error("playlist_breakdown_required: payload final ficaria com playlists=[]");
    }

    const res = await fetch(`${config.OPS_BASE}/bot-ingest-song-snapshot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bot-key": config.BOT_API_KEY,
        "x-worker-id": workerId ?? "",
        "x-correlation-id": correlation_id ?? "",
      },
      body: JSON.stringify(ingestPayload),
    });

    if (!res.ok) {
      const txt = await res.text();
      log.warn("bot-ingest-song-snapshot (catalog) erro", { status: res.status, body: txt.slice(0, 300) });
      throw new Error(`bot-ingest-song-snapshot ${res.status}: ${txt.slice(0, 300)}`);
    }

    log.info("bot-ingest-song-snapshot catalog ok", {
      catalog_track_id,
      queue_id,
      playlists: ingestPayload.playlists.length,
      rows_captured: result.rows_captured,
      scroll_passes: result.scroll_passes,
    });

    await insertBotEvent({
      bot_name: "spotify-artists-worker",
      step: "catalog.collect",
      status: "success",
      worker_id: workerId,
      correlation_id,
      duration_ms: Date.now() - t0,
      metadata: {
        catalog_track_id,
        queue_id,
        playlists: ingestPayload.playlists.length,
        rows_captured: result.rows_captured,
        scroll_passes: result.scroll_passes,
        filter_7d_applied: result.filter_7d_applied,
        total_plays_28d: result.total_plays_28d,
      },
    }).catch(() => {});

    return ingestPayload;
  } catch (e) {
    await insertBotEvent({
      bot_name: "spotify-artists-worker",
      step: "catalog.collect",
      status: e?.fatal ? "fatal" : "error",
      worker_id: workerId,
      correlation_id,
      duration_ms: Date.now() - t0,
      message: String(e?.message || e),
      metadata: { catalog_track_id, queue_id, spotify_track_id, requires_playlist_breakdown: requiresBreakdown },
    }).catch(() => {});
    throw e;
  }
}

export default spotifyCatalogCollect;