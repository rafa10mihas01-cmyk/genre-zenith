#!/usr/bin/env bash
# Deploy contínuo — git pull + install + reload sem downtime.
# Uso: bash scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."
echo "==> deploy NexEngine VPS"

# 1. Git pull (idempotente, falha se não for repo)
if [[ -d .git ]] || git -C .. rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "==> git pull"
  git pull --ff-only
else
  echo "[i] não é um repositório git, pulando git pull"
fi

# 2. Dependências (só roda se package.json mudou)
if [[ package.json -nt node_modules/.package-lock.json ]] || [[ ! -d node_modules ]]; then
  echo "==> npm install"
  npm install --omit=dev
fi

# 3. Reload zero-downtime
echo "==> pm2 reload (zero downtime)"
pm2 reload ecosystem.config.cjs --update-env
pm2 save

echo "==> deploy ok"
pm2 status
