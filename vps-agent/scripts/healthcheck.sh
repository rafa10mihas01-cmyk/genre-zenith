#!/usr/bin/env bash
# Healthcheck rápido para crontab/uptimerobot/monitor externo.
# Sai com código != 0 se algo crítico estiver fora.
set -euo pipefail

PORT="${HEALTHCHECK_PORT:-8787}"
URL="http://127.0.0.1:${PORT}/health"

resp="$(curl -fsS --max-time 5 "$URL" || true)"
if [[ -z "$resp" ]]; then
  echo "FAIL: healthcheck HTTP não respondeu em $URL"
  exit 2
fi

echo "$resp" | grep -q '"ok":true' || { echo "FAIL: payload inesperado: $resp"; exit 3; }

# Se PM2 disponível, valida que workers estão online
if command -v pm2 >/dev/null 2>&1; then
  bad="$(pm2 jlist | node -e "
    let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
      const list = JSON.parse(s||'[]');
      const bad = list.filter(p => /^nexengine-/.test(p.name) && p.pm2_env?.status !== 'online');
      console.log(bad.map(b => b.name+':'+b.pm2_env?.status).join(','));
    });
  " || true)"
  if [[ -n "$bad" ]]; then
    echo "FAIL: processos não-online: $bad"
    exit 4
  fi
fi

echo "OK"
exit 0
