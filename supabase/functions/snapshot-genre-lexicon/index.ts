// Snapshot semanal do léxico → genre_lexicon_history, marcando status:
// emerging | stable | declining | dead, comparando vs último snapshot.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: brain, error } = await sb
      .from('genre_brain')
      .select('genre_id, slug, top_tokens');
    if (error) throw error;

    const now = new Date().toISOString();
    const out: any[] = [];

    for (const b of brain ?? []) {
      const tokens = (b.top_tokens as any[]) ?? [];

      // último snapshot por gênero (uma data anterior)
      const { data: prev } = await sb
        .from('genre_lexicon_history')
        .select('term, weight, captured_at')
        .eq('genre_id', b.genre_id)
        .order('captured_at', { ascending: false })
        .limit(200);

      const prevMap = new Map<string, number>();
      const prevDate = prev?.[0]?.captured_at;
      (prev ?? []).filter(p => p.captured_at === prevDate).forEach(p => prevMap.set(p.term, Number(p.weight) || 0));

      const currentTerms = new Set<string>();
      tokens.forEach((t, i) => {
        const term = String(t.token);
        currentTerms.add(term);
        const w = Number(t.strength) || 0;
        const prevW = prevMap.get(term);
        let status: 'emerging' | 'stable' | 'declining' = 'stable';
        if (prevW == null) status = 'emerging';
        else if (w < prevW * 0.6) status = 'declining';
        else status = 'stable';
        out.push({
          genre_id: b.genre_id, slug: b.slug, term, weight: w,
          rank: i + 1, status, captured_at: now,
        });
      });

      // termos sumiram = dead
      for (const [term, w] of prevMap) {
        if (!currentTerms.has(term)) {
          out.push({
            genre_id: b.genre_id, slug: b.slug, term, weight: w,
            rank: null, status: 'dead', captured_at: now,
          });
        }
      }
    }

    if (out.length) {
      // insert in chunks
      for (let i = 0; i < out.length; i += 500) {
        const { error: ie } = await sb.from('genre_lexicon_history').insert(out.slice(i, i + 500));
        if (ie) throw ie;
      }
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
