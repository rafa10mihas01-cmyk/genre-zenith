import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const key = trimmed.slice(0, trimmed.indexOf("=")).trim();
    let value = trimmed.slice(trimmed.indexOf("=") + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(ENV_PATH);

const SUPA_FN_URL = String(process.env.SUPA_FN_URL || "").replace(/\/+$/, "");
const BOT_INGEST_TOKEN = String(process.env.BOT_INGEST_TOKEN || process.env.BOT_API_KEY || "").trim();
const OBSERVER_BATCH_SIZE = Number(process.env.OBSERVER_BATCH_SIZE || 5);
const OBSERVER_DAILY_LIMIT = Number(process.env.OBSERVER_DAILY_LIMIT || 30);
const OBSERVER_TICK_MS = Number(process.env.OBSERVER_TICK_MS || 300000);
const OBSERVER_THROTTLE_MS = Number(process.env.OBSERVER_THROTTLE_MS || 10000);
const OBSERVER_MAX_TRACKS = Number(process.env.OBSERVER_MAX_TRACKS || 100);
const OBSERVER_SCROLLS = Number(process.env.OBSERVER_SCROLLS || 20);
const HEADLESS = String(process.env.HEADLESS || "true").toLowerCase() !== "false";
const HOSTNAME = process.env.OBSERVER_HOSTNAME || os.hostname();

if (!SUPA_FN_URL) throw new Error("SUPA_FN_URL ausente no .env");
if (!BOT_INGEST_TOKEN) throw new Error("BOT_INGEST_TOKEN ausente no .env");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();

function headers(extra = {}) {
  return {
    "content-type": "application/json",
    "x-bot-token": BOT_INGEST_TOKEN,
    "x-hostname": HOSTNAME,
    ...extra,
  };
}

async function callJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error || json?.message || text || `HTTP ${res.status}`;
    throw new Error(`${url} -> ${res.status} ${msg}`);
  }
  return json;
}

async function pullQueue(limit = OBSERVER_BATCH_SIZE) {
  const url = `${SUPA_FN_URL}/observer-pull-queue?limit=${encodeURIComponent(limit)}`;
  const json = await callJson(url, { method: "GET", headers: headers() });
  return Array.isArray(json?.queue) ? json.queue : [];
}

async function ingestTracks(item, tracks, correlationId) {
  const payload = {
    spotify_playlist_id: item.spotify_playlist_id,
    correlation_id: correlationId,
    tracks,
  };
  return callJson(`${SUPA_FN_URL}/observer-ingest-tracks`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });
}

async function uploadFailure(item, correlationId, reason, page = null) {
  try {
    const payload = {
      spotify_playlist_id: item?.spotify_playlist_id || "unknown",
      correlation_id: correlationId,
      reason: String(reason || "unknown").slice(0, 1000),
    };
    if (page) {
      try { payload.html = await page.content(); } catch {}
      try {
        const shot = await page.screenshot({ fullPage: true, type: "png" });
        payload.screenshot_b64 = shot.toString("base64");
      } catch {}
    }
    await callJson(`${SUPA_FN_URL}/observer-upload-failure`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(`[failure-upload] ${err.message}`);
  }
}

function normalizeTrack(raw, index) {
  const spotify_track_id = String(raw.spotify_track_id || raw.id || "").trim();
  if (!spotify_track_id) return null;
  return {
    spotify_track_id,
    position: Number(raw.position || index + 1),
    name: raw.name || null,
    artist: raw.artist || null,
    album_name: raw.album_name || null,
    album_cover_url: raw.album_cover_url || null,
    duration_ms: typeof raw.duration_ms === "number" ? raw.duration_ms : null,
    raw,
  };
}

async function extractFromDom(page) {
  return page.evaluate(() => {
    const pickText = (root, selectors) => {
      for (const selector of selectors) {
        const el = root.querySelector(selector);
        const txt = el?.textContent?.trim();
        if (txt) return txt;
      }
      return null;
    };

    const rows = Array.from(document.querySelectorAll('[data-testid="tracklist-row"], [role="row"]'));
    const out = [];

    for (const row of rows) {
      const href = Array.from(row.querySelectorAll('a[href*="/track/"]'))
        .map((a) => a.getAttribute("href") || "")
        .find(Boolean);
      const match = href?.match(/\/track\/([A-Za-z0-9]+)/);
      const id = match?.[1];
      if (!id) continue;

      const name = pickText(row, [
        '[data-testid="internal-track-link"]',
        'a[href*="/track/"]',
        '[dir="auto"]',
      ]);

      const artists = Array.from(row.querySelectorAll('a[href*="/artist/"]'))
        .map((a) => a.textContent?.trim())
        .filter(Boolean)
        .join(", ") || null;

      const album = pickText(row, ['a[href*="/album/"]']);
      const img = row.querySelector("img")?.getAttribute("src") || null;

      out.push({
        spotify_track_id: id,
        name,
        artist: artists,
        album_name: album,
        album_cover_url: img,
      });
    }

    const seen = new Set();
    return out.filter((track) => {
      if (seen.has(track.spotify_track_id)) return false;
      seen.add(track.spotify_track_id);
      return true;
    });
  });
}

async function scrape(item, browser) {
  const playlistId = item.spotify_playlist_id;
  const url = item.url || `https://open.spotify.com/playlist/${playlistId}`;
  const context = await browser.newContext({
    locale: "pt-BR",
    viewport: { width: 1365, height: 900 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    console.log(`[scrape] ${playlistId} ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);

    try {
      const accept = page.getByRole("button", { name: /accept|aceitar|concordo|agree/i }).first();
      if (await accept.isVisible({ timeout: 2500 })) await accept.click({ timeout: 2500 });
    } catch {}

    let best = [];
    for (let i = 0; i < OBSERVER_SCROLLS; i++) {
      const tracks = await extractFromDom(page);
      if (tracks.length > best.length) best = tracks;
      if (best.length >= OBSERVER_MAX_TRACKS) break;
      await page.mouse.wheel(0, 1400);
      await page.waitForTimeout(900);
    }

    const normalized = best
      .slice(0, OBSERVER_MAX_TRACKS)
      .map(normalizeTrack)
      .filter(Boolean);

    if (normalized.length === 0) {
      throw new Error("no_tracks_extracted");
    }

    console.log(`[scrape] ${playlistId} tracks=${normalized.length}`);
    return { tracks: normalized, page };
  } catch (err) {
    await uploadFailure(item, `${playlistId}-${Date.now()}`, err.message, page);
    throw err;
  } finally {
    await context.close().catch(() => null);
  }
}

let doneToday = 0;
let dayKey = new Date().toISOString().slice(0, 10);

function resetDailyCounterIfNeeded() {
  const current = new Date().toISOString().slice(0, 10);
  if (current !== dayKey) {
    dayKey = current;
    doneToday = 0;
  }
}

async function tick(browser) {
  resetDailyCounterIfNeeded();
  const remaining = Math.max(0, OBSERVER_DAILY_LIMIT - doneToday);
  if (remaining <= 0) {
    console.log(`[tick] daily_limit_reached done_today=${doneToday}`);
    return;
  }

  const limit = Math.min(OBSERVER_BATCH_SIZE, remaining);
  const queue = await pullQueue(limit);
  console.log(`[tick] queue=${queue.length} done_today=${doneToday}`);

  if (queue.length === 0) return;

  for (const item of queue) {
    const correlationId = `${item.spotify_playlist_id}-${Date.now()}`;
    try {
      const { tracks } = await scrape(item, browser);
      const result = await ingestTracks(item, tracks, correlationId);
      doneToday += 1;
      console.log(`[ingest] ${item.spotify_playlist_id} tracks=${tracks.length} result=${JSON.stringify(result)}`);
    } catch (err) {
      console.error(`[error] ${item.spotify_playlist_id || "unknown"} ${err.stack || err.message}`);
    }
    await sleep(OBSERVER_THROTTLE_MS);
  }
}

async function main() {
  console.log("=== Observer start ===");
  console.log(`SUPA_FN_URL=${SUPA_FN_URL}`);
  console.log(`host=${HOSTNAME} batch=${OBSERVER_BATCH_SIZE} daily_limit=${OBSERVER_DAILY_LIMIT} tick_ms=${OBSERVER_TICK_MS}`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[shutdown] ${signal}`);
    await browser.close().catch(() => null);
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  while (!stopping) {
    try {
      await tick(browser);
    } catch (err) {
      console.error(`[tick-error] ${err.stack || err.message}`);
    }
    await sleep(OBSERVER_TICK_MS);
  }
}

main().catch((err) => {
  console.error(`[fatal] ${err.stack || err.message}`);
  process.exit(1);
});