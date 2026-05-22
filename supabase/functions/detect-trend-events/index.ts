// Varre últimos 7d das tabelas history e gera eventos em genre_trend_events.
// Regras:
//  - knowledge_score variou ±20% → editorial_shift
//  - novo termo no top10 (emerging) → term_emerging
//  - termo morreu → term_dying
//  - drift_count_7d cresceu → drift_detected
//  - leadership_score +25% em 7d → leader_rising; -25% → leader_falling
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const events: any[] = [];
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

    // ---- brain shifts
    const { data: brain } = await sb
      .from('genre_brain_history')
      .select('genre_id, slug, knowledge_score, recent_drifts_7d, captured_at')
      .gte('captured_at', weekAgo)
      .order('captured_at', { ascending: true });

    const byGenre = new Map<string, any[]>();
    (brain ?? []).forEach(r => {
      const arr = byGenre.get(r.genre_id) ?? [];
      arr.push(r); byGenre.set(r.genre_id, arr);
    });

    for (const [genre_id, arr] of byGenre) {
      if (arr.length < 2) continue;
      const first = arr[0], last = arr[arr.length - 1];
      const k0 = Number(first.knowledge_score) || 0;
      const k1 = Number(last.knowledge_score) || 0;
      if (k0 > 0 && Math.abs(k1 - k0) / k0 >= 0.2) {
        const dir = k1 > k0 ? 'subiu' : 'caiu';
        events.push({
          genre_id, subgenre_slug: last.slug,
          event_type: 'editorial_shift',
          title: `${last.slug}: conhecimento ${dir} ${Math.abs(((k1 - k0) / k0) * 100).toFixed(0)}%`,
          description: `Knowledge ${k0.toFixed(2)} → ${k1.toFixed(2)} em 7d`,
          payload: { from: k0, to: k1 },
          severity: Math.abs(k1 - k0) / k0 >= 0.4 ? 'strong' : 'notable',
          occurred_at: last.captured_at,
        });
      }
      const d0 = Number(first.recent_drifts_7d) || 0;
      const d1 = Number(last.recent_drifts_7d) || 0;
      if (d1 > d0 + 2) {
        events.push({
          genre_id, subgenre_slug: last.slug,
          event_type: 'drift_detected',
          title: `${last.slug}: ${d1 - d0} novos drifts em 7d`,
          payload: { from: d0, to: d1 },
          severity: 'notable', occurred_at: last.captured_at,
        });
      }
    }

    // ---- lexicon emerging/dying
    const { data: lex } = await sb
      .from('genre_lexicon_history')
      .select('genre_id, slug, term, status, captured_at')
      .gte('captured_at', weekAgo)
      .in('status', ['emerging', 'dead']);

    (lex ?? []).forEach(l => {
      events.push({
        genre_id: l.genre_id, subgenre_slug: l.slug,
        event_type: l.status === 'emerging' ? 'term_emerging' : 'term_dying',
        title: l.status === 'emerging' ? `Novo termo: "${l.term}"` : `Termo morreu: "${l.term}"`,
        payload: { term: l.term }, severity: 'info', occurred_at: l.captured_at,
      });
    });

    // ---- leadership rise/fall
    const { data: lh } = await sb
      .from('playlist_leadership_history')
      .select('playlist_id, leadership_score, captured_at')
      .gte('captured_at', weekAgo)
      .order('captured_at', { ascending: true });

    const byPl = new Map<string, any[]>();
    (lh ?? []).forEach(r => {
      const arr = byPl.get(r.playlist_id) ?? [];
      arr.push(r); byPl.set(r.playlist_id, arr);
    });

    // resolve nomes
    const plIds = [...byPl.keys()].slice(0, 200);
    const { data: pls } = plIds.length
      ? await sb.from('playlists').select('id, name').in('id', plIds)
      : { data: [] as any[] };
    const nameMap = new Map((pls ?? []).map((p: any) => [p.id, p.name]));

    for (const [pid, arr] of byPl) {
      if (arr.length < 2) continue;
      const a = Number(arr[0].leadership_score) || 0;
      const b = Number(arr[arr.length - 1].leadership_score) || 0;
      if (a > 0 && Math.abs(b - a) / a >= 0.25) {
        const rising = b > a;
        events.push({
          playlist_id: pid, // not in schema; ignored
          event_type: rising ? 'leader_rising' : 'leader_falling',
          title: `${nameMap.get(pid) ?? pid}: leadership ${rising ? '+' : ''}${(((b - a) / a) * 100).toFixed(0)}%`,
          payload: { playlist_id: pid, from: a, to: b },
          severity: Math.abs(b - a) / a >= 0.5 ? 'strong' : 'notable',
          occurred_at: arr[arr.length - 1].captured_at,
        });
      }
    }

    // strip non-existent column playlist_id from events
    const clean = events.map(({ playlist_id, ...rest }) => rest);

    if (clean.length) {
      const { error: ie } = await sb.from('genre_trend_events').insert(clean);
      if (ie) throw ie;
    }

    return new Response(JSON.stringify({ ok: true, events: clean.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
