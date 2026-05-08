#!/usr/bin/env bash
# Gera/regenera storageState do Spotify for Artists com o MESMO fingerprint do worker.
# Isso é CRÍTICO: se o UA/locale/tz divergirem, Spotify invalida a sessão headless.
# Rodar no console gráfico (ou X-forwarding/VNC) — abre Chromium não-headless p/ login manual.
set -euo pipefail

cd "$(dirname "$0")/.."

# Carrega .env (mesmas vars do runtime)
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

OUT="${SPOTIFY_STORAGE_STATE_PATH:-/opt/nexengine/secrets/spotify-session.json}"
UA="${PLAYWRIGHT_USER_AGENT:-Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36}"
LOCALE="${PLAYWRIGHT_LOCALE:-pt-BR}"
TZ_ID="${PLAYWRIGHT_TZ:-America/Sao_Paulo}"
VW="${PLAYWRIGHT_VIEWPORT_W:-1440}"
VH="${PLAYWRIGHT_VIEWPORT_H:-900}"
DPR="${PLAYWRIGHT_DPR:-2}"

mkdir -p "$(dirname "$OUT")"

echo "==> abrindo Chromium com fingerprint do worker"
echo "    UA=$UA"
echo "    locale=$LOCALE  tz=$TZ_ID  viewport=${VW}x${VH}@${DPR}x"
echo "    saída: $OUT"

OUT_PATH="$OUT" UA_VAL="$UA" LOCALE_VAL="$LOCALE" TZ_VAL="$TZ_ID" \
VW_VAL="$VW" VH_VAL="$VH" DPR_VAL="$DPR" \
node -e "
(async () => {
  const { chromium } = await import('playwright-extra');
  const Stealth = (await import('puppeteer-extra-plugin-stealth')).default;
  chromium.use(Stealth());
  const b = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled','--no-first-run','--no-default-browser-check','--lang=pt-BR'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const c = await b.newContext({
    userAgent: process.env.UA_VAL,
    locale: process.env.LOCALE_VAL,
    timezoneId: process.env.TZ_VAL,
    viewport: { width: Number(process.env.VW_VAL), height: Number(process.env.VH_VAL) },
    deviceScaleFactor: Number(process.env.DPR_VAL),
    colorScheme: 'dark',
  });
  const p = await c.newPage();
  await p.goto('https://artists.spotify.com');
  process.stdout.write('Logue na conta e pressione ENTER aqui... ');
  process.stdin.once('data', async () => {
    await c.storageState({ path: process.env.OUT_PATH });
    await b.close();
    console.log('\\nsessão salva em ' + process.env.OUT_PATH);
    process.exit(0);
  });
})();
"
