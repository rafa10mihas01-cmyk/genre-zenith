#!/usr/bin/env bash
# Phase 17-C — Observer Pathfinder apply script (idempotent, non-interactive).
# Target: Ubuntu 24.04 + Node 18 + PM2. Run on the Observer VPS as root.
set -Eeuo pipefail

OBSERVER_DIR="/root/genre-zenith/vps-agent/observer"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="services/playlistScraper.js"
PAYLOAD_FILE="${SCRIPT_DIR}/services/playlistScraper.js"
PORT="3100"
HEALTH_URL="http://127.0.0.1:${PORT}/health"
SAMPLE_PLAYLIST_ID="37i9dQZF1DXcBWIGoYBM5M"
PLAYLIST_URL="http://127.0.0.1:${PORT}/playlists/${SAMPLE_PLAYLIST_ID}"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP=""

log()  { printf '\033[1;36m[17c]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[17c]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[17c]\033[0m %s\n' "$*" >&2; }

restore_backup() {
  if [[ -n "$BACKUP" && -f "$BACKUP" ]]; then
    err "Restaurando backup: $BACKUP"
    cp -f "$BACKUP" "$TARGET"
    restart_observer || true
  fi
}

restart_observer() {
  if command -v pm2 >/dev/null 2>&1 && pm2 describe observer >/dev/null 2>&1; then
    log "pm2 restart observer"
    pm2 restart observer >/dev/null
  else
    log "PM2 não tem 'observer'. Matando porta ${PORT} e subindo via nohup."
    fuser -k "${PORT}/tcp" 2>/dev/null || true
    for _ in {1..20}; do
      if ! fuser "${PORT}/tcp" >/dev/null 2>&1; then
        break
      fi
      sleep 0.5
    done
    if fuser "${PORT}/tcp" >/dev/null 2>&1; then
      err "Porta ${PORT} ainda ocupada após fuser -k. PIDs: $(fuser "${PORT}/tcp" 2>/dev/null || true)"
      return 1
    fi
    nohup node server.js > observer.log 2>&1 &
    log "Observer iniciado em background (pid=$!)."
    disown || true
  fi
}

wait_for_health() {
  local body=""
  local last_error=""
  for _ in {1..60}; do
    if body="$(curl -fsS --max-time 2 "$HEALTH_URL" 2>&1)"; then
      HEALTH_BODY="$body"
      return 0
    fi
    last_error="$body"
    sleep 1
  done
  err "Último erro de /health: $last_error"
  return 1
}

trap 'rc=$?; if [[ $rc -ne 0 ]]; then err "Falha (exit=$rc). Tentando restaurar backup..."; restore_backup; fi' ERR

if [[ ! -f "$PAYLOAD_FILE" ]]; then
  err "Payload não encontrado: $PAYLOAD_FILE"
  err "Execute este script a partir do pacote docs/ops/phase-17c-observer-vps completo."
  exit 2
fi

if [[ "$(pwd)" != "$OBSERVER_DIR" ]]; then
  if [[ -d "$OBSERVER_DIR" ]]; then
    cd "$OBSERVER_DIR"
    log "cd $OBSERVER_DIR"
  else
    err "Diretório $OBSERVER_DIR não existe."
    exit 2
  fi
fi

if [[ ! -f "$TARGET" ]]; then
  err "Arquivo $TARGET não existe em $(pwd). Abortando."
  exit 2
fi

PAYLOAD_HASH="$(sha256sum "$PAYLOAD_FILE" | awk '{print $1}')"
CURRENT_HASH="$(sha256sum "$TARGET" | awk '{print $1}')"
log "Payload 17-C: $PAYLOAD_FILE"
log "SHA256 payload 17-C: $PAYLOAD_HASH"
log "SHA256 atual em produção: $CURRENT_HASH"

BACKUP="${TARGET}.pre17c-${STAMP}"
cp -f "$TARGET" "$BACKUP"
ok "Backup criado: $BACKUP"

if [[ "$PAYLOAD_HASH" == "$CURRENT_HASH" ]]; then
  log "Conteúdo já está na versão 17-C (hash idêntico). Pulando reescrita."
else
  TMP="$(mktemp)"
  cp -f "$PAYLOAD_FILE" "$TMP"
  mv -f "$TMP" "$TARGET"
  ok "playlistScraper.js substituído pelo payload 17-C."
fi

DEPLOYED_HASH="$(sha256sum "$TARGET" | awk '{print $1}')"
if [[ "$DEPLOYED_HASH" != "$PAYLOAD_HASH" ]]; then
  err "Hash copiado diverge do payload: target=$DEPLOYED_HASH payload=$PAYLOAD_HASH"
  exit 3
fi
ok "SHA256 carregado no target confirma payload: $DEPLOYED_HASH"

log "node --check $TARGET"
node --check "$TARGET"
ok "Sintaxe OK."

log "Validando export ESM getPlaylist..."
node --input-type=module - <<'NODE'
const mod = await import(`file://${process.cwd()}/services/playlistScraper.js?check=${Date.now()}`);
if (typeof mod.getPlaylist !== 'function') {
  throw new Error('services/playlistScraper.js não exporta getPlaylist');
}
NODE
ok "Export getPlaylist OK."

restart_observer

log "GET $HEALTH_URL"
HEALTH_BODY=""
if ! wait_for_health; then
  err "Falha em /health. Restaurando backup."
  restore_backup
  exit 4
fi
ok "/health respondeu: $(printf '%s' "$HEALTH_BODY" | head -c 200)"

log "GET $PLAYLIST_URL"
if ! PLAYLIST_BODY="$(curl -fsS --max-time 60 "$PLAYLIST_URL")"; then
  err "Falha em $PLAYLIST_URL. Restaurando backup."
  restore_backup
  exit 5
fi

log "Validando contrato do primeiro track..."
VALIDATION="$(node -e '
  let raw = "";
  process.stdin.on("data", c => raw += c);
  process.stdin.on("end", () => {
    let j;
    try { j = JSON.parse(raw); } catch (e) {
      console.error("JSON inválido:", e.message); process.exit(10);
    }
    const tracks = Array.isArray(j.tracks) ? j.tracks : null;
    if (!tracks || tracks.length === 0) {
      console.error("Resposta não contém tracks[]"); process.exit(11);
    }
    const t = tracks[0];
    const required = ["playcount","duration_ms","album","artists","uri","track_id"];
    const missing = required.filter(k => !(k in t) || t[k] === null || t[k] === undefined);
    if (missing.length) {
      console.error("Campos ausentes no primeiro track:", missing.join(", "));
      console.error("Sample keys:", Object.keys(t).join(","));
      process.exit(12);
    }
    if (typeof t.album !== "object" || !t.album)             { console.error("album não é objeto"); process.exit(13); }
    if (!Array.isArray(t.artists) || t.artists.length === 0) { console.error("artists vazio");      process.exit(14); }
    console.log("OK first track:", JSON.stringify({
      track_id: t.track_id, uri: t.uri, name: t.name,
      playcount: t.playcount, duration_ms: t.duration_ms,
      album_name: t.album.name, artists: t.artists.map(a => a.name)
    }));
  });
' <<<"$PLAYLIST_BODY")" || {
  err "Validação do primeiro track falhou. Restaurando backup."
  err "$VALIDATION"
  restore_backup
  exit 6
}

ok "$VALIDATION"

FINAL_HASH="$(sha256sum "$TARGET" | awk '{print $1}')"
if [[ "$FINAL_HASH" != "$PAYLOAD_HASH" ]]; then
  err "Hash final diverge do payload: final=$FINAL_HASH payload=$PAYLOAD_HASH"
  restore_backup
  exit 7
fi

trap - ERR
ok "✅ Phase 17-C aplicada com sucesso. SHA256 em produção: $FINAL_HASH"