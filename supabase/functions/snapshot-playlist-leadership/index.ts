// Snapshot diário do playlist_leadership → playlist_leadership_history.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data, error } = await sb
      .from('playlist_leadership')
      .select('playlist_id, leadership_score, freshness_rank, follower_rank, growth_rank, activity_rank, evidence')
      .order('leadership_score', { ascending: false, nullsFirst: false });
    if (error) throw error;

    const now = new Date().toISOString();
    const rows = (data ?? []).map((r, i) => ({
      ...r,
      rank_position: i + 1,
      followers: (r.evidence as any)?.followers ?? null,
      captured_at: now,
    }));

    if (rows.length) {
      const { error: ie } = await sb.from('playlist_leadership_history').insert(rows);
      if (ie) throw ie;
    }

    return new Response(JSON.stringify({ ok: true, snapshots: rows.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
