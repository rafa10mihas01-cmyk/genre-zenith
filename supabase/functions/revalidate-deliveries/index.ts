// Revalidação periódica: para cada job ADD done de campanhas ativas,
// confere no Spotify se a faixa ainda está presente e em qual posição.
// Grava histórico em playlist_delivery_validations e atualiza colunas
// last_validation_* em playlist_execution_jobs.
//
// Status possíveis:
//  - present   → faixa na posição planejada
//  - moved     → presente mas em posição diferente
//  - duplicate → faixa aparece >1x
//  - removed   → faixa não está mais na playlist
//  - error     → falha ao consultar (token inválido, 4xx/5xx)

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { listPlaylistTrackRefs } from '../_shared/spotify-playlist.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

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

  const { data: jobs } = await sb
    .from('playlist_execution_jobs')
    .select('id, campaign_id, spotify_playlist_id, to_position')
    .eq('status', 'done')
    .eq('job_type', 'playlist.track.add')
    .in('campaign_id', [...campMap.keys()]);

  // dedupe por (playlist, track) — só uma checagem por par
  const uniq = new Map<string, any>();
  for (const j of jobs ?? []) {
    const c = campMap.get(j.campaign_id);
    if (!c) continue;
    const k = `${j.spotify_playlist_id}|${c.spotify_track_id}`;
    if (!uniq.has(k)) uniq.set(k, { ...j, spotify_track_id: c.spotify_track_id });
  }

  // mapa playlist→token
  const pids = [...new Set([...uniq.values()].map((j) => j.spotify_playlist_id))];
  const { data: pls } = await sb
    .from('playlists')
    .select('spotify_playlist_id, account_id')
    .in('spotify_playlist_id', pids);
  const plMap = new Map(pls?.map((p) => [p.spotify_playlist_id, p]) ?? []);
  // filtra nulos: playlists sem account_id não vão pra IN(...) — senão a query quebra e contamina o lote
  const acctIds = [
    ...new Set(
      (pls ?? [])
        .map((p) => p.account_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const { data: accts, error: acctsErr } = acctIds.length
    ? await sb
        .from('accounts')
        .select('id, spotify_user_token_id')
        .in('id', acctIds)
    : { data: [], error: null };
  if (acctsErr) console.error('[revalidate] accounts query error', acctsErr);
  const tokIds = (accts ?? [])
    .map((a) => a.spotify_user_token_id)
    .filter((id): id is string => !!id);
  const { data: toks, error: toksErr } = tokIds.length
    ? await sb
        .from('spotify_user_tokens')
        .select('id, access_token')
        .in('id', tokIds)
    : { data: [], error: null };
  if (toksErr) console.error('[revalidate] tokens query error', toksErr);
  const tokById = new Map(toks?.map((t) => [t.id, t.access_token]) ?? []);
  const tokByAcct = new Map(
    (accts ?? []).map((a) => [a.id, tokById.get(a.spotify_user_token_id)]),
  );

  // cache por playlist pra evitar listar duas vezes a mesma
  const refsCache = new Map<string, { id: string }[]>();

  let counts = { present: 0, moved: 0, duplicate: 0, removed: 0, error: 0, skipped: 0 };
  const validations: any[] = [];
  const jobUpdates: { id: string; status: string; position: number | null }[] = [];

  for (const j of uniq.values()) {
    const pl = plMap.get(j.spotify_playlist_id);
    // playlist sem account_id mapeado → pula sem poluir o lote nem gerar erro global
    if (!pl || !pl.account_id) {
      counts.skipped++;
      console.warn(
        `[revalidate] skip playlist ${j.spotify_playlist_id} — sem account_id vinculado`,
      );
      continue;
    }
    const tok = tokByAcct.get(pl.account_id);
    if (!tok) {
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
        error: 'sem token',
      });
      jobUpdates.push({ id: j.id, status: 'error', position: null });
      continue;
    }

    try {
      let refs = refsCache.get(j.spotify_playlist_id);
      if (!refs) {
        refs = await listPlaylistTrackRefs(j.spotify_playlist_id, tok);
        refsCache.set(j.spotify_playlist_id, refs);
      }
      const positions: number[] = [];
      refs.forEach((r, idx) => {
        if (r.id === j.spotify_track_id) positions.push(idx + 1);
      });
      const actual = positions[0] ?? null;
      let status: string;
      if (positions.length > 1) {
        status = 'duplicate';
        counts.duplicate++;
      } else if (actual == null) {
        status = 'removed';
        counts.removed++;
      } else if (actual === j.to_position) {
        status = 'present';
        counts.present++;
      } else {
        status = 'moved';
        counts.moved++;
      }
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

  // grava histórico em lote
  if (validations.length) {
    await sb.from('playlist_delivery_validations').insert(validations);
  }
  // atualiza job (em paralelo)
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
    JSON.stringify({ ok: true, checked: uniq.size, counts }, null, 2),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
