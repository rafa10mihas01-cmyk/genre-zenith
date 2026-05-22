// Snapshot diário do mix de gêneros das playlists líderes → playlist_drift_snapshots.
// Usa genre_trends como fonte (já tem track→bucket→genre).
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // top 100 líderes
    const { data: leaders, error } = await sb
      .from('playlist_leadership')
      .select('playlist_id, evidence')
      .order('leadership_score', { ascending: false })
      .limit(100);
    if (error) throw error;

    const now = new Date().toISOString();
    const out: any[] = [];

    for (const l of leaders ?? []) {
      const ev = (l.evidence as any) ?? {};
      const mix = ev.genre_mix ?? ev.mix ?? null;
      if (!mix) continue;
      // mix esperado: { genre_slug: weight }
      let dominant: string | null = null;
      let max = -1;
      for (const [k, v] of Object.entries(mix as Record<string, number>)) {
        if (Number(v) > max) { max = Number(v); dominant = k; }
      }
      out.push({
        playlist_id: l.playlist_id,
        playlist_spotify_id: ev.spotify_id ?? null,
        genre_mix: mix,
        dominant_genre: dominant,
        track_sample_size: ev.sample_size ?? null,
        captured_at: now,
      });
    }

    if (out.length) {
      const { error: ie } = await sb.from('playlist_drift_snapshots').insert(out);
      if (ie) throw ie;
    }

    return new Response(JSON.stringify({ ok: true, snapshots: out.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
