#!/usr/bin/env bash
# Gera/regenera storageState do Spotify for Artists (sessão persistente).
# Requer DISPLAY (rodar no console gráfico ou via X-forwarding/VNC).
# Uso: bash scripts/spotify-session.sh
set -euo pipefail

cd "$(dirname "$0")/.."

OUT="${SPOTIFY_STORAGE_STATE_PATH:-/opt/nexengine/secrets/spotify-session.json}"
mkdir -p "$(dirname "$OUT")"

echo "==> abrindo Chromium (faça login manual e pressione ENTER no terminal)"
node -e "
(async () => {
  const { chromium } = require('playwright');
  const b = await chromium.launch({ headless: false });
  const c = await b.newContext();
  const p = await c.newPage();
  await p.goto('https://artists.spotify.com');
  process.stdout.write('Logue na conta e pressione ENTER aqui... ');
  process.stdin.once('data', async () => {
    await c.storageState({ path: '$OUT' });
    await b.close();
    console.log('\\nsessão salva em $OUT');
    process.exit(0);
  });
})();
"
