#!/usr/bin/env bash
# Phase 17-E — Observer LRU cache + PM2 max_memory_restart.
# Fix for OOM memory leak (unbounded Map cache in server.js).
# Run on the Observer VPS as root.
set -Eeuo pipefail

OBSERVER_DIR="/root/genre-zenith/vps-agent/observer"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="3100"
HEALTH_URL="http://127.0.0.1:${PORT}/health"

STAMP="$(date -u +%Y%m%d-%H%M%S)"

log() { printf '\033[1;36m[17e]\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m[17e]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[17e]\033[0m %s\n' "$*" >&2; }

if [[ ! -d "$OBSERVER_DIR" ]]; then
  err "Diretório $OBSERVER_DIR não existe."
  exit 2
fi

cd "$OBSERVER_DIR"
log "cwd=$OBSERVER_DIR"

# 1. Backup + copy patched server.js
if [[ -f server.js ]]; then
  cp -f server.js "server.js.pre17e-${STAMP}"
  ok "Backup: server.js.pre17e-${STAMP}"
fi
cp -f "${SCRIPT_DIR}/server.js" server.js
ok "server.js atualizado (LRU + sweep + /health metrics)."

# 2. Copy PM2 ecosystem
cp -f "${SCRIPT_DIR}/ecosystem.config.cjs" ecosystem.config.cjs
ok "ecosystem.config.cjs instalado (max_memory_restart=600M)."

# 3. Syntax check
node --check server.js
ok "Sintaxe OK."

# 4. Restart via PM2 ecosystem (creates 'observer' app if missing, otherwise reloads)
if ! command -v pm2 >/dev/null 2>&1; then
  err "PM2 não encontrado. Instale com: npm i -g pm2"
  exit 3
fi

if pm2 describe observer >/dev/null 2>&1; then
  log "pm2 delete observer (para aplicar novo ecosystem)"
  pm2 delete observer >/dev/null || true
fi

log "pm2 start ecosystem.config.cjs --only observer"
pm2 start ecosystem.config.cjs --only observer
pm2 save >/dev/null
ok "Observer iniciado via PM2 ecosystem."

# 5. Wait for /health
log "Aguardando $HEALTH_URL ..."
for _ in {1..60}; do
  if BODY="$(curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null)"; then
    ok "/health OK: $BODY"
    break
  fi
  sleep 1
done

if [[ -z "${BODY:-}" ]]; then
  err "Observer não respondeu em /health após 60s. Veja: pm2 logs observer"
  exit 4
fi

ok "✅ Phase 17-E aplicada. Monitore com:"
echo "    watch -n 10 'curl -s ${HEALTH_URL} | python3 -m json.tool'"
echo "    pm2 monit"
