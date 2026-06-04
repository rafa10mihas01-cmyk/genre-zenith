// Audit: verifica se faixas das campanhas ativas estão duplicadas/ausentes nas playlists.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { listPlaylistTrackRefs, findPlaylistTrackIndex } from '../_shared/spotify-playlist.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // pega jobs done de campanhas ativas
  const { data: jobs, error: je } = await sb
    .from('playlist_execution_jobs')
    .select('spotify_playlist_id, to_position, campaign_id, campaigns!inner(track_name, spotify_track_id, status)')
    .eq('status', 'done')
    .eq('job_type', 'playlist.track.add');
  if (je) return new Response(JSON.stringify({ error: je.message }), { status: 500, headers: corsHeaders });

  const active = (jobs ?? []).filter((j: any) => j.campaigns.status === 'active');

  // dedupe por (playlist, track)
  const uniq = new Map<string, any>();
  for (const j of active) {
    const k = `${j.spotify_playlist_id}|${j.campaigns.spotify_track_id}`;
    if (!uniq.has(k)) uniq.set(k, j);
  }

  // mapa playlist -> account/token
  const pids = [...new Set([...uniq.values()].map(j => j.spotify_playlist_id))];
  const { data: pls } = await sb.from('playlists').select('spotify_playlist_id, name, account_id').in('spotify_playlist_id', pids);
  const plMap = new Map(pls?.map(p => [p.spotify_playlist_id, p]) ?? []);
  const acctIds = [...new Set(pls?.map(p => p.account_id) ?? [])];
  const { data: accts } = await sb.from('accounts').select('id, spotify_user_token_id').in('id', acctIds);
  const { data: toks } = await sb.from('spotify_user_tokens').select('id, access_token').in('id', accts?.map(a => a.spotify_user_token_id) ?? []);
  const tokById = new Map(toks?.map(t => [t.id, t.access_token]) ?? []);
  const tokByAcct = new Map(accts?.map(a => [a.id, tokById.get(a.spotify_user_token_id)]) ?? []);

  const results: any[] = [];
  let ok = 0, dup = 0, missing = 0, mismatch = 0, err = 0;

  for (const j of uniq.values()) {
    const pl = plMap.get(j.spotify_playlist_id);
    const tok = pl ? tokByAcct.get(pl.account_id) : null;
    if (!tok) { err++; results.push({ track: j.campaigns.track_name, playlist: pl?.name, error: 'sem token' }); continue; }
    try {
      const refs = await listPlaylistTrackRefs(j.spotify_playlist_id, tok);
      const positions: number[] = [];
      refs.forEach((r, idx) => { if (r.id === j.campaigns.spotify_track_id) positions.push(idx + 1); });
      const actual = positions[0] ?? null;
      let status: string;
      if (positions.length > 1) { status = 'DUPLICATA'; dup++; }
      else if (actual === j.to_position) { status = 'OK'; ok++; }
      else if (actual) { status = `posicao_diferente(${actual})`; mismatch++; }
      else { status = 'AUSENTE'; missing++; }
      results.push({ track: j.campaigns.track_name, playlist: pl?.name, planejado: j.to_position, real: actual, occurrences: positions.length, positions, status });
    } catch (e: any) {
      err++; results.push({ track: j.campaigns.track_name, playlist: pl?.name, error: e.message?.slice(0, 200) });
    }
  }

  return new Response(JSON.stringify({ summary: { ok, dup, missing, mismatch, err, total: uniq.size }, results }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
