#!/usr/bin/env bash
# Startup completo da VPS — primeira instalação OU recriação do ambiente.
# Idempotente: pode rodar várias vezes sem quebrar nada existente.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "==> NexEngine VPS startup em $ROOT"

# 1. Node + PM2
if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js não encontrado. Instale Node >=18.17 antes de continuar."
  exit 1
fi
if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> instalando PM2 global"
  npm install -g pm2@5
fi

# 2. .env
if [[ ! -f .env ]]; then
  echo "==> criando .env a partir de .env.example (preencha os valores!)"
  cp .env.example .env
  echo "[!] EDITE .env antes de continuar (OPS_AGENT_TOKEN)."
  exit 1
fi

# 3. Diretórios runtime
mkdir -p logs
sudo mkdir -p /opt/nexengine/secrets || mkdir -p /opt/nexengine/secrets || true

# 4. Dependências
echo "==> npm install"
npm install --omit=dev

# 5. Playwright browsers (Chromium)
echo "==> playwright install chromium"
npx playwright install --with-deps chromium

# 6. Sessão Spotify
SESSION_PATH="${SPOTIFY_STORAGE_STATE_PATH:-/opt/nexengine/secrets/spotify-session.json}"
if [[ ! -f "$SESSION_PATH" ]]; then
  echo "[!] Sessão Spotify ausente em $SESSION_PATH"
  echo "    Rode (uma vez, com display) o script descrito no README §8 para gerar."
fi

# 7. Boot PM2
echo "==> pm2 start ecosystem.config.cjs"
pm2 start ecosystem.config.cjs --update-env
pm2 save

echo "==> ok. status:"
pm2 status
