// Snapshot diário do genre_brain → genre_brain_history.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { reportCronHealth } from '../_shared/cron-health.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const startedAt = Date.now();
  try {
    const { data: brain, error } = await sb
      .from('genre_brain')
      .select('genre_id, slug, knowledge_score, avg_leadership_score, recent_drifts_7d, active_leaders, playlists_with_genre, avg_confidence, tokens_total, tokens_strong');
    if (error) throw error;

    const enriched = [] as any[];
    for (const b of brain ?? []) {
      const { data: fresh } = await sb
        .from('playlist_leadership')
        .select('freshness_rank')
        .limit(500);
      const freshAvg = fresh?.length
        ? fresh.reduce((s, r) => s + (Number(r.freshness_rank) || 0), 0) / fresh.length
        : null;

      const { data: clus } = await sb
        .from('playlist_clusters')
        .select('strength')
        .eq('genre_id', b.genre_id);
      const clusAvg = clus?.length
        ? clus.reduce((s, r) => s + (Number(r.strength) || 0), 0) / clus.length
        : null;

      enriched.push({
        ...b,
        freshness_avg: freshAvg,
        cluster_strength_avg: clusAvg,
        captured_at: new Date().toISOString(),
      });
    }

    if (enriched.length) {
      const { error: insErr } = await sb.from('genre_brain_history').insert(enriched);
      if (insErr) throw insErr;
    }

    await reportCronHealth(sb, {
      job_name: 'snapshot-genre-brain',
      status: 'ok',
      startedAt,
      metrics: { genres: brain?.length ?? 0, snapshots: enriched.length },
    });

    return new Response(JSON.stringify({ ok: true, snapshots: enriched.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    await reportCronHealth(sb, {
      job_name: 'snapshot-genre-brain',
      status: 'error',
      startedAt,
      message: String((e as Error).message),
    });
    return new Response(JSON.stringify({ error: String((e as Error).message) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
