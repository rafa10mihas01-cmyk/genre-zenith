// phase17d-observer-compat — Validação de compatibilidade do contrato Observer 17-C.
//
// Objetivo: ANTES de migrar qualquer worker (revalidate-deliveries, etc.), conferir
// se o que o Observer da VPS está emitindo hoje bate com:
//   1. A spec documentada em docs/ops/phase-17c-observer-http-contract.md
//   2. As tipagens declaradas em _shared/observer-playlist.ts
//
// Uso:
//   curl -X POST .../functions/v1/phase17d-observer-compat \
//        -H "Authorization: Bearer <SERVICE_ROLE>" \
//        -H "Content-Type: application/json" \
//        -d '{"playlist_id":"37i9dQZF1DXcBWIGoYBM5M"}'
//
// Saída: relatório JSON com a forma real recebida + lista de campos faltantes
// classificados por severidade (blocker / warning / info).

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import {
  isObserverConfigured,
  observerGetPlaylist,
  observerListPlaylistItems,
  ObserverNotConfiguredError,
  ObserverApiError,
} from '../_shared/observer-playlist.ts';

type FieldCheck = {
  path: string;
  expected: string;
  present: boolean;
  actual_type: string;
  severity: 'blocker' | 'warning' | 'info';
  note?: string;
};

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array(len=${v.length})`;
  return typeof v;
}

function checkField(
  obj: Record<string, unknown> | null | undefined,
  path: string,
  expected: string,
  severity: FieldCheck['severity'],
  predicate?: (v: unknown) => boolean,
  note?: string,
): FieldCheck {
  if (obj == null) {
    return { path, expected, present: false, actual_type: 'parent-missing', severity, note };
  }
  const segs = path.split('.');
  let cur: any = obj;
  for (const s of segs) {
    if (cur == null) break;
    cur = cur[s];
  }
  const present = cur !== undefined && cur !== null && (predicate ? predicate(cur) : true);
  return { path, expected, present, actual_type: typeOf(cur), severity, note };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!isObserverConfigured()) {
    return new Response(
      JSON.stringify({ ok: false, error: 'OBSERVER_BASE_URL / OBSERVER_TOKEN não configurados' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let body: { playlist_id?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const playlistId = body.playlist_id || '37i9dQZF1DXcBWIGoYBM5M'; // Today's Top Hits (pública, estável)

  const report: Record<string, unknown> = {
    playlist_id: playlistId,
    checked_at: new Date().toISOString(),
    phase: '17-D step 1: contract compatibility',
  };

  // ---------- 1) GET /playlists/:id ----------
  try {
    const meta = await observerGetPlaylist(playlistId, { maxAgeSeconds: 600 }) as any;
    const metaChecks: FieldCheck[] = [
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
  } catch (e: any) {
    report.meta_endpoint = {
      error: String(e?.message ?? e),
      error_class: e instanceof ObserverApiError ? 'ObserverApiError' : e instanceof ObserverNotConfiguredError ? 'ObserverNotConfiguredError' : 'unknown',
    };
  }

  // ---------- 2) GET /playlists/:id/items ----------
  try {
    const page = await observerListPlaylistItems(playlistId, { offset: 0, limit: 5, maxAgeSeconds: 600 }) as any;
    const first = Array.isArray(page?.items) && page.items.length > 0 ? page.items[0] : null;

    const pageChecks: FieldCheck[] = [
      checkField(page, 'items', 'array', 'blocker', (v) => Array.isArray(v)),
      checkField(page, 'total', 'number', 'warning'),
      checkField(page, 'limit', 'number', 'info'),
      checkField(page, 'offset', 'number', 'info'),
      checkField(page, 'next', 'string | null', 'warning'),
    ];

    // Estes são os campos que `revalidate-deliveries` REALMENTE precisa.
    const itemChecks: FieldCheck[] = first ? [
      checkField(first, 'track.id', 'string', 'blocker', undefined,
        'Worker revalidate-deliveries depende de it.track?.id para confirmar entrega.'),
      checkField(first, 'track.name', 'string', 'warning'),
      checkField(first, 'track.uri', 'string', 'warning'),
      checkField(first, 'track.duration_ms', 'number', 'info', undefined, 'Novo no 17-C.'),
      checkField(first, 'track.artists', 'array(of {id,name})', 'warning', (v) =>
        Array.isArray(v) && v.length > 0 && typeof (v[0] as any)?.id === 'string',
        'Spec exige objetos {id,name}. VPS pode estar emitindo só nomes (string[]).'),
      checkField(first, 'track.album.id', 'string', 'warning', undefined, 'Spec; VPS pode emitir só album_name.'),
      checkField(first, 'track.album.name', 'string', 'info'),
      checkField(first, 'position', 'number', 'warning'),
      checkField(first, 'added_at', 'string | null', 'info'),
      // Campos FLAT que o apply-17c.sh observou — se presentes, indicam que o
      // Observer ainda não envelopa no shape spec'd.
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
  } catch (e: any) {
    report.items_endpoint = {
      error: String(e?.message ?? e),
      error_class: e instanceof ObserverApiError ? 'ObserverApiError' : 'unknown',
    };
  }

  // ---------- 3) Veredito ----------
  const allChecks: FieldCheck[] = [
    ...((report.meta_endpoint as any)?.checks ?? []),
    ...((report.items_endpoint as any)?.page_checks ?? []),
    ...((report.items_endpoint as any)?.item_checks ?? []),
  ];
  const blockers = allChecks.filter((c) => c.severity === 'blocker' && !c.present);
  const warnings = allChecks.filter((c) => c.severity === 'warning' && !c.present);
  report.verdict = {
    safe_to_migrate_revalidate_deliveries: blockers.length === 0,
    blockers_missing: blockers,
    warnings_missing: warnings,
    summary: blockers.length === 0
      ? `OK: contrato compatível para migração. ${warnings.length} warnings (não bloqueiam).`
      : `BLOQUEADO: ${blockers.length} campos blocker ausentes. Worker quebraria se migrado agora.`,
  };

  return new Response(JSON.stringify(report, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
