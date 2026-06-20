// Revalidação periódica — POLÍTICA "CONFIRMA UMA VEZ":
//
// Pra cada job ADD `done` de campanha ativa, confere no Spotify se a faixa
// está na playlist. Quando o status vira `present` / `moved` / `duplicate`
// (= a faixa entrou e está lá), o job é marcado como confirmado e NUNCA
// mais é re-checado. Só jobs nunca validados, ou que ficaram em `error` /
// `removed`, voltam pra fila.
//
// Fase 17-B.1: leitura agora vai pelo Catalog Gateway (Client Credentials +
// cache 24h + coalescência). Não precisa mais de token OAuth do dono —
// `GET playlists/{id}/tracks` em playlist pública é endpoint público.
//
// Salvaguardas:
//  - Lote pequeno (default 50, máx 200) — evita varrer tudo de uma vez.
//  - Respeita o circuit breaker do Spotify: se mais da metade das apps
//    estiver `open`, a função sai sem chamar nada.
//  - Cron deve rodar de hora em hora — não de 1 em 1 min.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getPlaylistItems } from '../_shared/catalog-gateway.ts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Circuit breaker check ─────────────────────────────────────────────
  const { data: breakers } = await sb
    .from('spotify_circuit_breaker')
    .select('status, blocked_until');
  const total = breakers?.length ?? 0;
  const openNow = (breakers ?? []).filter(
    (b) => b.status === 'open' && (!b.blocked_until || new Date(b.blocked_until) > new Date()),
  ).length;
  if (total > 0 && openNow * 2 >= total) {
    return new Response(
      JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'circuit_breaker_majority_open',
        open: openNow,
        total,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── Limite do lote ────────────────────────────────────────────────────
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const rawLimit = Number(body?.limit ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;

  // ── Campanhas ativas ──────────────────────────────────────────────────
  const { data: camps } = await sb
    .from('campaigns')
    .select('id, spotify_track_id')
    .eq('status', 'active');
  const campMap = new Map((camps ?? []).map((c) => [c.id, c]));
  if (campMap.size === 0) {
    return new Response(JSON.stringify({ ok: true, checked: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Jobs candidatos a revalidar ───────────────────────────────────────
  const { data: jobs } = await sb
    .from('playlist_execution_jobs')
    .select('id, campaign_id, spotify_playlist_id, to_position, last_validation_status, last_validated_at')
    .eq('status', 'done')
    .eq('job_type', 'playlist.track.add')
    .in('campaign_id', [...campMap.keys()])
    .or(`last_validation_status.is.null,last_validation_status.in.(error,removed)`)
    .order('last_validated_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  // dedupe por (playlist, track) — uma checagem por par
  const uniq = new Map<string, any>();
  for (const j of jobs ?? []) {
    const c = campMap.get(j.campaign_id);
    if (!c) continue;
    const k = `${j.spotify_playlist_id}|${c.spotify_track_id}`;
    if (!uniq.has(k)) uniq.set(k, { ...j, spotify_track_id: c.spotify_track_id });
  }

  if (uniq.size === 0) {
    return new Response(
      JSON.stringify({ ok: true, checked: 0, note: 'nada pendente de confirmação' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── Loop de validação (via Catalog Gateway) ──────────────────────────
  // Não precisa mais buscar accounts/tokens — gateway usa CC.
  const itemsCache = new Map<string, { track_id: string }[]>();
  const counts = { present: 0, moved: 0, duplicate: 0, removed: 0, error: 0, skipped: 0 };
  const validations: any[] = [];
  const jobUpdates: { id: string; status: string; position: number | null }[] = [];

  for (const j of uniq.values()) {
    try {
      let items = itemsCache.get(j.spotify_playlist_id);
      if (!items) {
        items = await getPlaylistItems(j.spotify_playlist_id, 'revalidate-deliveries');
        itemsCache.set(j.spotify_playlist_id, items);
      }
      const positions: number[] = [];
      items.forEach((r, idx) => {
        if (r.track_id === j.spotify_track_id) positions.push(idx + 1);
      });
      const actual = positions[0] ?? null;
      let status: string;
      if (positions.length > 1) { status = 'duplicate'; counts.duplicate++; }
      else if (actual == null) { status = 'removed'; counts.removed++; }
      else if (actual === j.to_position) { status = 'present'; counts.present++; }
      else { status = 'moved'; counts.moved++; }

      validations.push({
        job_id: j.id,
        campaign_id: j.campaign_id,
        spotify_playlist_id: j.spotify_playlist_id,
        spotify_track_id: j.spotify_track_id,
        expected_position: j.to_position,
        actual_position: actual,
        occurrences: positions.length,
        status,
      });
      jobUpdates.push({ id: j.id, status, position: actual });
    } catch (e: any) {
      counts.error++;
      validations.push({
        job_id: j.id,
        campaign_id: j.campaign_id,
        spotify_playlist_id: j.spotify_playlist_id,
        spotify_track_id: j.spotify_track_id,
        expected_position: j.to_position,
        actual_position: null,
        occurrences: 0,
        status: 'error',
        error: String(e?.message ?? e).slice(0, 300),
      });
      jobUpdates.push({ id: j.id, status: 'error', position: null });
    }
  }

  if (validations.length) {
    await sb.from('playlist_delivery_validations').insert(validations);
  }
  await Promise.all(
    jobUpdates.map((u) =>
      sb
        .from('playlist_execution_jobs')
        .update({
          last_validated_at: new Date().toISOString(),
          last_validation_status: u.status,
          last_validation_position: u.position,
        })
        .eq('id', u.id),
    ),
  );

  return new Response(
    JSON.stringify({
      ok: true,
      checked: uniq.size,
      limit,
      counts,
      via: 'catalog-gateway-cc',
      policy: 'confirm_once: present/moved/duplicate never re-checked',
    }, null, 2),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
