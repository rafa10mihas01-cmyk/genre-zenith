# Playlist Observer Bot — Guia de Instalação na VPS

Este bot roda **na sua VPS** (a mesma que hospeda o FortiSIEM) como um
processo PM2 isolado. Ele consome endpoints já criados no Lovable Cloud:

- `GET  /functions/v1/observer-pull-queue?limit=5` → recebe a fila
- `POST /functions/v1/observer-ingest-tracks` → envia tracks coletadas
- `POST /functions/v1/observer-upload-failure` → envia screenshot+html em falha
- `POST /functions/v1/bot-heartbeat` → mantém status (use `bot_name: "playlist-observer"`)
- `POST /functions/v1/bot-event-ingest` → eventos granulares

**Auth:** todos os endpoints exigem header `x-bot-token: <BOT_INGEST_TOKEN>`
(o mesmo token que o bot principal já usa).

---

## 1. Preparar o usuário Linux dedicado

```bash
sudo useradd -m -s /bin/bash observer
sudo -u observer mkdir -p /home/observer/playlist-observer
```

> Mantém isolado do FortiSIEM e do bot atual.

## 2. Instalar Node 20 e Chromium

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs chromium-browser fonts-liberation \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libasound2
sudo npm i -g pm2
```

## 3. Código do bot

Crie `/home/observer/playlist-observer/index.mjs`:

```javascript
import { chromium } from "playwright";
import fetch from "node-fetch";

const API = process.env.SUPA_FN_URL;          // ex: https://xtxxjmkijeyxkdyxtvsf.functions.supabase.co
const TOKEN = process.env.BOT_INGEST_TOKEN;
const HOST = process.env.HOSTNAME || "observer-vps";
const DAILY_LIMIT = parseInt(process.env.OBSERVER_DAILY_LIMIT || "30", 10);
const BATCH = parseInt(process.env.OBSERVER_BATCH_SIZE || "5", 10);
const THROTTLE_MS = parseInt(process.env.OBSERVER_THROTTLE_MS || "10000", 10);
const COUNTER_FILE = "/tmp/observer-counter.json";

const fs = await import("fs/promises");

async function loadCount() {
  try {
    const j = JSON.parse(await fs.readFile(COUNTER_FILE, "utf8"));
    const today = new Date().toISOString().slice(0, 10);
    return j.date === today ? j.count : 0;
  } catch { return 0; }
}
async function saveCount(n) {
  await fs.writeFile(COUNTER_FILE, JSON.stringify({
    date: new Date().toISOString().slice(0, 10), count: n,
  }));
}

const headers = { "content-type": "application/json", "x-bot-token": TOKEN, "x-hostname": HOST };

async function heartbeat(status, message) {
  await fetch(`${API}/bot-heartbeat`, {
    method: "POST", headers,
    body: JSON.stringify({ bot_name: "playlist-observer", status, message, hostname: HOST }),
  }).catch(() => null);
}

async function pullQueue() {
  const r = await fetch(`${API}/observer-pull-queue?limit=${BATCH}`, { headers });
  return (await r.json()).queue ?? [];
}

async function scrape(browser, item) {
  const ctx = await browser.newContext({
    locale: "pt-BR",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  const correlation = `obs-${Date.now()}-${item.spotify_playlist_id}`;
  try {
    await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector('[data-testid="tracklist-row"]', { timeout: 15000 });
    // scroll para carregar todas
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(400);
    }
    const tracks = await page.$$eval('[data-testid="tracklist-row"]', (rows) => rows.map((row, idx) => {
      const link = row.querySelector('a[href^="/track/"]');
      const trackId = link?.getAttribute("href")?.split("/")[2] ?? null;
      const name = link?.textContent?.trim() ?? null;
      const artist = row.querySelector('a[href^="/artist/"]')?.textContent?.trim() ?? null;
      const albumA = row.querySelector('a[href^="/album/"]');
      const albumName = albumA?.textContent?.trim() ?? null;
      const cover = row.querySelector('img')?.getAttribute("src") ?? null;
      const durTxt = row.querySelector('[data-testid="tracklist-duration"]')?.textContent?.trim() ?? null;
      let duration_ms = null;
      if (durTxt && /^\d+:\d{2}$/.test(durTxt)) {
        const [m, s] = durTxt.split(":").map(Number); duration_ms = (m * 60 + s) * 1000;
      }
      return { spotify_track_id: trackId, position: idx + 1, name, artist, album_name: albumName, album_cover_url: cover, duration_ms };
    }));
    const valid = tracks.filter(t => t.spotify_track_id);
    if (valid.length < 5) throw new Error(`too_few_tracks:${valid.length}`);
    await fetch(`${API}/observer-ingest-tracks`, {
      method: "POST", headers,
      body: JSON.stringify({ spotify_playlist_id: item.spotify_playlist_id, correlation_id: correlation, tracks: valid }),
    });
    return { ok: true, count: valid.length };
  } catch (e) {
    const png = await page.screenshot({ fullPage: false }).catch(() => null);
    const html = await page.content().catch(() => null);
    await fetch(`${API}/observer-upload-failure`, {
      method: "POST", headers,
      body: JSON.stringify({
        spotify_playlist_id: item.spotify_playlist_id,
        correlation_id: correlation,
        reason: String(e?.message ?? e),
        screenshot_b64: png ? png.toString("base64") : null,
        html,
      }),
    }).catch(() => null);
    return { ok: false, error: String(e?.message ?? e) };
  } finally {
    await ctx.close();
  }
}

async function tick() {
  let done = await loadCount();
  if (done >= DAILY_LIMIT) {
    await heartbeat("rate_capped", `limit ${DAILY_LIMIT} atingido hoje`);
    return;
  }
  const queue = await pullQueue();
  if (queue.length === 0) { await heartbeat("idle", "fila vazia"); return; }
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  let consecFail = 0;
  for (const item of queue) {
    if (done >= DAILY_LIMIT) break;
    const r = await scrape(browser, item);
    done++;
    await saveCount(done);
    await heartbeat("online", `${item.spotify_playlist_id} ${r.ok ? "ok" : "fail"}`);
    consecFail = r.ok ? 0 : consecFail + 1;
    if (consecFail >= 3) { await heartbeat("paused", "3 falhas seguidas, pausando 1h"); await new Promise(r => setTimeout(r, 60 * 60 * 1000)); consecFail = 0; }
    await new Promise(r => setTimeout(r, THROTTLE_MS));
  }
  await browser.close();
}

await heartbeat("online", "boot");
setInterval(tick, 5 * 60 * 1000);
tick();
```

`package.json`:

```json
{
  "name": "playlist-observer",
  "type": "module",
  "version": "1.0.0",
  "dependencies": { "playwright": "^1.45.0", "node-fetch": "^3.3.2" }
}
```

```bash
cd /home/observer/playlist-observer
sudo -u observer npm i
sudo -u observer npx playwright install chromium
```

## 4. Variáveis de ambiente (`/home/observer/playlist-observer/.env`)

```env
SUPA_FN_URL=https://xtxxjmkijeyxkdyxtvsf.functions.supabase.co
BOT_INGEST_TOKEN=<COLE O MESMO TOKEN DO BOT PRINCIPAL>
HOSTNAME=observer-vps-01
OBSERVER_DAILY_LIMIT=30
OBSERVER_BATCH_SIZE=5
OBSERVER_THROTTLE_MS=10000
```

## 5. PM2

```bash
cd /home/observer/playlist-observer
sudo -u observer pm2 start index.mjs --name playlist-observer --update-env
sudo -u observer pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u observer --hp /home/observer
```

## 6. Validação (em 1h)

No painel Lovable:
- Sistema → Bots: deve aparecer `playlist-observer` com heartbeat verde.
- Tabela `observer_playlist_tracks` deve ter linhas; quero ver ≥1 playlist com `track_count ≥ 20` e `album_cover_url` preenchido em ≥95% das linhas.
- Se vier falha, baixe a evidência do bucket `observer-failures`.

## O que NÃO mexer
- Nada da pasta/usuário do FortiSIEM.
- Bot atual (`spotify-artists-bot`) — esse continua intocado.
