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

// Lista ordenada de seletores tentados para casar a "linha" da tabela de playlists
// do S4A. A tela /playlists do Catálogo NÃO usa o mesmo data-testid da tela do Deal
// (sort-table-body-row vinha retornando 0). Tentamos do mais específico para o mais
// genérico, e em último caso caímos no fallback ancorado em `a[href*="/playlist/"]`
// (ver pickRowSelector no page.evaluate abaixo).
const ROW_SEL_CANDIDATES = [
  '[data-testid="sort-table-body-row"]',
  '[data-testid="table-row"]',
  '[data-testid$="-row"]',
  '[data-testid*="row"]',
  '[role="row"][aria-rowindex]',
  '[role="row"]:not([aria-hidden="true"])',
  'tbody tr',
  'li[data-testid]',
];
// Mantido por compat com capturePlaylistPrints (resolvido em runtime).
let ROW_SEL = ROW_SEL_CANDIDATES[0];
const SCROLL_CONTAINER = '#chrome-v2-main-content-scroll-root';
const ROWS_PER_PRINT = 16;
const SCREENSHOT_UPLOAD_TIMEOUT_MS = 45_000;
const INGEST_TIMEOUT_MS = 60_000;
const BOT_EVENT_TIMEOUT_MS = 15_000;

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout_after_${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

async function detectRowSelector(page) {
  // Roda no browser: testa cada candidato e devolve o primeiro que tem >= 1 linha
  // contendo um link de playlist. Loga as contagens (CATALOG_DEBUG_SELECTORS) pra
  // diagnóstico. Se nenhum casar, devolve null e o extrator cai no fallback
  // ancorado em `a[href*="/playlist/"]`.
  const report = await page.evaluate((candidates) => {
    const out = [];
    for (const sel of candidates) {
      let total = 0, withLink = 0;
      try {
        const nodes = document.querySelectorAll(sel);
        total = nodes.length;
        nodes.forEach((n) => {
          if (n.querySelector('a[href*="/playlist/"], a[href*="spotify:playlist:"]')) withLink++;
        });
      } catch (e) {
        out.push({ sel, error: String(e?.message || e) });
        continue;
      }
      out.push({ sel, total, withLink });
    }
    const anchorCount = document.querySelectorAll('a[href*="/playlist/"], a[href*="spotify:playlist:"]').length;
    return { candidates: out, anchorCount };
  }, ROW_SEL_CANDIDATES);

  const winner = report.candidates.find((c) => (c.withLink ?? 0) > 0);
  log.info("CATALOG_DEBUG_SELECTORS", { winner: winner?.sel ?? null, anchorCount: report.anchorCount, candidates: report.candidates });
  return winner?.sel ?? null;
}

async function extractVisiblePlaylistRows(page, rowSelectorOverride) {
  // Se `rowSelectorOverride` casar, usa como antes. Caso contrário, ancora em
  // `a[href*="/playlist/"]` e sobe pra um ancestral "row-like".
  return await page.evaluate(({ rowSelector }) => {
    const norm = (txt) => String(txt || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const isNumericMetric = (txt) => !!txt && /\d/.test(txt) && /^[\d.,\s]+[km]?$/i.test(txt);

    function findRowAncestor(el) {
      let cur = el;
      for (let i = 0; i < 12 && cur; i++) {
        if (cur.matches?.('tr, [role="row"], li[data-testid], [data-testid*="row" i], [data-row-index]')) return cur;
        cur = cur.parentElement;
      }
      cur = el;
      for (let i = 0; i < 8 && cur && cur.parentElement; i++) {
        cur = cur.parentElement;
        const t = norm(cur.textContent);
        const last = t.split(/\s+/).pop() || "";
        if (isNumericMetric(last)) return cur;
      }
      return el.parentElement || el;
    }

    let rows = [];
    if (rowSelector) rows = Array.from(document.querySelectorAll(rowSelector));
    if (rows.length === 0) {
      const anchors = Array.from(document.querySelectorAll('a[href*="/playlist/"], a[href*="spotify:playlist:"]'));
      const seenRows = new Set();
      for (const a of anchors) {
        const row = findRowAncestor(a);
        if (row && !seenRows.has(row)) { seenRows.add(row); rows.push(row); }
      }
    }

    const result = [];
    rows.forEach((row) => {
      const linkEl = row.querySelector('a[href*="/playlist/"], a[href*="spotify:playlist:"]');
      if (!linkEl) return;
      const href = linkEl.href || linkEl.getAttribute("href") || null;
      const ariaLabel = row.getAttribute("aria-label") || "";
      const idSource = `${href || ""} ${ariaLabel}`;
      const idMatch = idSource.match(/spotify:playlist:([a-zA-Z0-9]{15,})|\/playlist[/:]([a-zA-Z0-9]{15,})/);
      const playlistId = idMatch ? (idMatch[1] || idMatch[2]) : null;

      const playlist_name = norm(linkEl.textContent) || norm(linkEl.getAttribute("aria-label")) || null;
      if (!playlistId && !playlist_name) return;

      const nameCell = linkEl.closest('td, [role="cell"], [role="gridcell"]') || row;
      const owner = (() => {
        const cands = Array.from(nameCell.querySelectorAll("p, span, small, div"))
          .map((el) => norm(el.textContent))
          .filter((t) => t && t !== playlist_name && !isNumericMetric(t) && t.length < 80);
        return cands.find((t) => t !== playlist_name) || null;
      })();

      let cells = Array.from(row.querySelectorAll('td, [role="cell"], [role="gridcell"]'));
      if (cells.length === 0) cells = Array.from(row.querySelectorAll("span, div, p"));
      let playsText = null;
      const metricCandidates = [];
      for (let i = cells.length - 1; i >= 0; i--) {
        const t = norm(cells[i].textContent);
        if (isNumericMetric(t)) { metricCandidates.push(t); if (!playsText) playsText = t; }
      }

      result.push({
        href,
        playlistId,
        playlist_name,
        owner,
        plays_text: playsText,
        metric_text_candidates: metricCandidates,
      });
    });
    return result;
  }, { rowSelector: rowSelectorOverride ?? null });
}


async function scrapePlaylistBreakdown(page, statsUrl) {
  const totals = await readTotalPlays(page, statsUrl);

  const playlistsUrl = statsUrl.replace("/stats", "/playlists");
  log.info("navegando para playlists", { url: playlistsUrl });
  log.info("CATALOG_STEP_2_PRE_GOTO_PLAYLISTS", { playlistsUrl });
  try {
    await page.goto(playlistsUrl, { waitUntil: "networkidle", timeout: 30000 });
  } catch (e) {
    log.error("CATALOG_STEP_2_GOTO_FAILED", {
      name: e?.name, message: e?.message, stack: String(e?.stack || "").slice(0, 2000),
      url: page.url(),
    });
    throw e;
  }
  log.info("CATALOG_STEP_2_POST_GOTO_PLAYLISTS", { url: page.url() });

  try {
    log.info("CATALOG_STEP_2A_ASSERT_LOGIN", {});
    await assertLoggedIn(page);

    log.info("CATALOG_STEP_2B_WAIT_PRINTAREA", {});
    await page.locator(SELECTORS.printArea).first().waitFor({ state: "visible", timeout: 15000 });

    log.info("CATALOG_STEP_2C_WAIT_2S", {});
    await page.waitForTimeout(2000);

    log.info("CATALOG_STEP_2D_APPLY_FILTER_7D", {});
    const playlist_filter_7d_applied = await applySevenDayFilter(page);
    log.info("CATALOG_STEP_2E_FILTER_DONE", { playlist_filter_7d_applied });

    // Espera pelo menos um link de playlist aparecer (mais estável que data-testid).
    try {
      await page.locator('a[href*="/playlist/"]').first().waitFor({ state: "visible", timeout: 15000 });
      log.info("CATALOG_STEP_2F_ROW_VISIBLE", {});
    } catch {
      log.warn("nenhum a[href*=/playlist/] visível em 15s", {});
    }

    // Detecta o seletor de "row" real desta tela (cacheia pro restante do job).
    const detectedRowSel = await detectRowSelector(page);
    if (detectedRowSel) ROW_SEL = detectedRowSel;

    const playlists = [];
    const seen = new Set();
    let passesWithoutNew = 0;
    let scroll_passes = 0;

    log.info("CATALOG_STEP_2G_ENTER_LOOP", { rowSelector: detectedRowSel ?? "anchor-fallback" });
    while (passesWithoutNew < 3 && scroll_passes < 80) {
      scroll_passes++;
      const rows = await extractVisiblePlaylistRows(page, detectedRowSel);
      if (scroll_passes === 1) {
        log.info("CATALOG_DEBUG_ROWS", { rows: rows.length, sample: rows.slice(0, 3).map((r) => ({ name: r.playlist_name, id: r.playlistId, plays: r.plays_text })) });
      }
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

    log.info("CATALOG_STEP_2H_LOOP_DONE", { rows_captured: playlists.length, scroll_passes });
    log.info("playlists capturadas", { rows_captured: playlists.length, scroll_passes });

    return {
      ...totals,
      playlists,
      rows_captured: playlists.length,
      scroll_passes,
      playlist_filter_7d_applied,
    };
  } catch (e) {
    let pageUrl = null, pageTitle = null, bodyText = null;
    try { pageUrl = page.url(); } catch {}
    try { pageTitle = await page.title(); } catch (te) { pageTitle = `__title_failed:${te?.message}`; }
    try {
      bodyText = await page.locator("body").innerText({ timeout: 3000 });
      if (bodyText && bodyText.length > 1000) bodyText = bodyText.slice(0, 1000);
    } catch (be) { bodyText = `__body_failed:${be?.message}`; }
    log.error("CATALOG_STEP_2_BLOCK_FAILED", {
      name: e?.name || null,
      message: e?.message || String(e),
      stack: String(e?.stack || "").slice(0, 4000),
      pageUrl,
      pageTitle,
      bodyText,
    });
    throw e;
  }
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
    log.warn("multi_print_required sem buffers suficientes; seguindo para ingest estruturado", {
      playlists: playlists.length,
      screenshot_buffers: screenshot_buffers.length,
    });
  }

  const print_urls = [];
  const totalParts = screenshot_buffers.length;
  for (let i = 0; i < screenshot_buffers.length; i++) {
      try {
        const up = await withTimeout(
          uploadScreenshot(
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
          ),
          SCREENSHOT_UPLOAD_TIMEOUT_MS,
          "uploadScreenshot",
        );
        const url = up?.signed_url ?? up?.publicUrl ?? null;
        if (url) print_urls.push(url);
      } catch (e) {
        log.warn("uploadScreenshot catalog falhou; seguindo para ingest estruturado", {
          catalog_track_id,
          correlation_id,
          part: i + 1,
          totalParts,
          err: String(e?.message || e),
        });
      }
  }

  if (playlists.length > 30 && print_urls.length <= 1) {
    log.warn("multi_print_required sem prints suficientes; seguindo para ingest estruturado", {
      playlists: playlists.length,
      print_urls: print_urls.length,
    });
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
      await page.locator('a[href*="/playlist/"]').first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      const detected = await detectRowSelector(page);
      if (detected) ROW_SEL = detected;
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

    const res = await withTimeout(
      fetch(`${config.OPS_BASE}/bot-ingest-song-snapshot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bot-key": config.BOT_API_KEY,
          "x-worker-id": workerId ?? "",
          "x-correlation-id": correlation_id ?? "",
        },
        body: JSON.stringify(ingestPayload),
      }),
      INGEST_TIMEOUT_MS,
      "bot-ingest-song-snapshot",
    );

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

    await withTimeout(
      insertBotEvent({
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
      }),
      BOT_EVENT_TIMEOUT_MS,
      "insertBotEvent(success)",
    ).catch((eventErr) => {
      log.warn("insertBotEvent success falhou; retornando payload mesmo assim", { err: String(eventErr?.message || eventErr) });
    });

    return ingestPayload;
  } catch (e) {
    await withTimeout(
      insertBotEvent({
        bot_name: "spotify-artists-worker",
        step: "catalog.collect",
        status: e?.fatal ? "fatal" : "error",
        worker_id: workerId,
        correlation_id,
        duration_ms: Date.now() - t0,
        message: String(e?.message || e),
        metadata: { catalog_track_id, queue_id, spotify_track_id, requires_playlist_breakdown: requiresBreakdown },
      }),
      BOT_EVENT_TIMEOUT_MS,
      "insertBotEvent(error)",
    ).catch((eventErr) => {
      log.warn("insertBotEvent error falhou", { err: String(eventErr?.message || eventErr) });
    });
    throw e;
  }
}

export default spotifyCatalogCollect;