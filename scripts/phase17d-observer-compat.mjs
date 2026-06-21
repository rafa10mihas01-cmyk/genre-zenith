#!/usr/bin/env node
// =============================================================================
// phase17d-observer-compat.mjs
// -----------------------------------------------------------------------------
// Validação LOCAL do contrato Observer 17-C, rodando direto na VPS contra
// http://127.0.0.1:3100. Não usa Supabase, Service Role, Edge Function nem
// nenhuma variável SUPABASE_*. Único requisito: ter acesso ao Observer local.
//
// Uso na VPS (sem auth — endpoint local):
//   node scripts/phase17d-observer-compat.mjs
//
// Com auth (qualquer um dos nomes abaixo é aceito automaticamente):
//   OPS_AGENT_TOKEN=... node scripts/phase17d-observer-compat.mjs
//   BOT_INGEST_TOKEN=... node scripts/phase17d-observer-compat.mjs
//   BOT_API_KEY=...      node scripts/phase17d-observer-compat.mjs
//   OBSERVER_TOKEN=...   node scripts/phase17d-observer-compat.mjs
//
// Forçar nome do header (default tenta vários):
//   OBSERVER_AUTH_HEADER=x-ops-agent-token OPS_AGENT_TOKEN=... node ...
//
// Opcional:
//   OBSERVER_BASE_URL=http://127.0.0.1:3100   (default)
//   PLAYLIST_ID=37i9dQZF1DXcBWIGoYBM5M         (default: Today's Top Hits)
//
// Saída: JSON em stdout. Exit 0 se safe_to_migrate_revalidate_deliveries=true,
// exit 1 caso contrário.
// =============================================================================

const BASE = (process.env.OBSERVER_BASE_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '');
const PLAYLIST_ID = process.env.PLAYLIST_ID || '37i9dQZF1DXcBWIGoYBM5M';

// Resolve token a partir de qualquer variável conhecida (primeira não vazia vence)
const TOKEN_CANDIDATES = [
  ['OBSERVER_TOKEN',   'x-observer-token'],
  ['OPS_AGENT_TOKEN',  'x-ops-agent-token'],
  ['BOT_INGEST_TOKEN', 'x-bot-ingest-token'],
  ['BOT_API_KEY',      'x-api-key'],
];
let TOKEN = '';
let TOKEN_SOURCE = null;
let AUTH_HEADER = process.env.OBSERVER_AUTH_HEADER || '';
for (const [envName, hdr] of TOKEN_CANDIDATES) {
  const v = process.env[envName];
  if (v && v.trim()) {
    TOKEN = v.trim();
    TOKEN_SOURCE = envName;
    if (!AUTH_HEADER) AUTH_HEADER = hdr;
    break;
  }
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array(len=${v.length})`;
  return typeof v;
}

function checkField(obj, path, expected, severity, predicate, note) {
  if (obj == null) {
    return { path, expected, present: false, actual_type: 'parent-missing', severity, note };
  }
  const segs = path.split('.');
  let cur = obj;
  for (const s of segs) {
    if (cur == null) break;
    cur = cur[s];
  }
  const present = cur !== undefined && cur !== null && (predicate ? predicate(cur) : true);
  return { path, expected, present, actual_type: typeOf(cur), severity, note };
}

async function observerFetch(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const headers = { Accept: 'application/json' };
  if (TOKEN && AUTH_HEADER) headers[AUTH_HEADER] = TOKEN;
  const r = await fetch(url.toString(), { method: 'GET', headers });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`Observer ${r.status}: ${text.slice(0, 400)}`);
    err.status = r.status;
    err.body = text;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

async function main() {
  const report = {
    playlist_id: PLAYLIST_ID,
    observer_base_url: BASE,
    observer_token_present: !!TOKEN,
    checked_at: new Date().toISOString(),
    phase: '17-D step 1: contract compatibility (local VPS run)',
  };

  // 0) /health
  try {
    report.health = await observerFetch('/health');
  } catch (e) {
    report.health = { error: String(e.message || e), status: e.status };
  }

  // 1) GET /playlists/:id
  try {
    const meta = await observerFetch(`/playlists/${encodeURIComponent(PLAYLIST_ID)}`, { max_age: 600 });
    const metaChecks = [
      checkField(meta, 'id', 'string', 'blocker'),
      checkField(meta, 'name', 'string', 'blocker'),
      checkField(meta, 'snapshot_id', 'string | null', 'warning'),
      checkField(meta, 'owner.id', 'string', 'warning'),
      checkField(meta, 'owner.display_name', 'string | null', 'info'),
      checkField(meta, 'followers.total', 'number', 'warning'),
      checkField(meta, 'tracks.total', 'number', 'blocker'),
      checkField(meta, 'images', 'array', 'info', (v) => Array.isArray(v)),
      checkField(meta, 'observer.captured_at', 'string', 'warning'),
      checkField(meta, 'observer.source', 'cache | fresh_scrape', 'info'),
    ];
    report.meta_endpoint = {
      sample_top_level_keys: Object.keys(meta ?? {}),
      checks: metaChecks,
      raw_sample: meta,
    };
  } catch (e) {
    report.meta_endpoint = { error: String(e.message || e), status: e.status };
  }

  // 2) GET /playlists/:id/items
  try {
    const page = await observerFetch(
      `/playlists/${encodeURIComponent(PLAYLIST_ID)}/items`,
      { offset: 0, limit: 5, max_age: 600 },
    );
    const first = Array.isArray(page?.items) && page.items.length > 0 ? page.items[0] : null;

    const pageChecks = [
      checkField(page, 'items', 'array', 'blocker', (v) => Array.isArray(v)),
      checkField(page, 'total', 'number', 'warning'),
      checkField(page, 'limit', 'number', 'info'),
      checkField(page, 'offset', 'number', 'info'),
      checkField(page, 'next', 'string | null', 'warning'),
    ];

    // Campos que `revalidate-deliveries` REALMENTE precisa.
    const itemChecks = first ? [
      checkField(first, 'track.id', 'string', 'blocker', undefined,
        'Worker revalidate-deliveries depende de it.track?.id para confirmar entrega.'),
      checkField(first, 'track.name', 'string', 'warning'),
      checkField(first, 'track.uri', 'string', 'warning'),
      checkField(first, 'track.duration_ms', 'number', 'info', undefined, 'Novo no 17-C.'),
      checkField(first, 'track.artists', 'array(of {id,name})', 'warning', (v) =>
        Array.isArray(v) && v.length > 0 && typeof v[0]?.id === 'string',
        'Spec exige objetos {id,name}. VPS pode estar emitindo só nomes (string[]).'),
      checkField(first, 'track.album.id', 'string', 'warning', undefined, 'Spec; VPS pode emitir só album_name.'),
      checkField(first, 'track.album.name', 'string', 'info'),
      checkField(first, 'position', 'number', 'warning'),
      checkField(first, 'added_at', 'string | null', 'info'),
      // Campos FLAT observados no apply-17c.sh — se presentes, indicam shape fora da spec.
      checkField(first, 'track_id', '(flat) string', 'info', undefined, 'Presença indica shape flat fora da spec.'),
      checkField(first, 'playcount', '(flat) number', 'info', undefined, 'Campo novo Pathfinder. Não está na spec.'),
      checkField(first, 'album_name', '(flat) string', 'info', undefined, 'Presença indica shape flat fora da spec.'),
    ] : [];

    report.items_endpoint = {
      sample_top_level_keys: Object.keys(page ?? {}),
      page_checks: pageChecks,
      first_item_keys: first ? Object.keys(first) : [],
      first_item_track_keys: first?.track ? Object.keys(first.track) : [],
      item_checks: itemChecks,
      raw_first_item: first,
    };
  } catch (e) {
    report.items_endpoint = { error: String(e.message || e), status: e.status };
  }

  // 3) Veredito
  const allChecks = [
    ...((report.meta_endpoint?.checks) ?? []),
    ...((report.items_endpoint?.page_checks) ?? []),
    ...((report.items_endpoint?.item_checks) ?? []),
  ];
  const blockers = allChecks.filter((c) => c.severity === 'blocker' && !c.present);
  const warnings = allChecks.filter((c) => c.severity === 'warning' && !c.present);
  const safe = blockers.length === 0
    && !report.meta_endpoint?.error
    && !report.items_endpoint?.error;

  report.verdict = {
    safe_to_migrate_revalidate_deliveries: safe,
    blockers_missing: blockers,
    warnings_missing: warnings,
    summary: safe
      ? `OK: contrato compatível para migração. ${warnings.length} warnings (não bloqueiam).`
      : `BLOQUEADO: ${blockers.length} blockers, ${warnings.length} warnings. Worker quebraria se migrado agora.`,
  };

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(safe ? 0 : 1);
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({
    ok: false,
    fatal: String(e?.message ?? e),
    stack: e?.stack,
  }, null, 2) + '\n');
  process.exit(2);
});
