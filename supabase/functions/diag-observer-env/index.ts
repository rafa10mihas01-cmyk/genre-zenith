import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const u = Deno.env.get('OBSERVER_BASE_URL') ?? '';
  const t = Deno.env.get('OBSERVER_TOKEN') ?? '';
  const codes = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
  // Tentativa de fetch real, capturando o erro literal
  let fetchErr: string | null = null;
  let fetchStatus: number | null = null;
  const cleanU = u.trim().replace(/\/+$/, '');
  const cleanT = t.replace(/[^\x21-\x7e]/g, '');
  const results: Record<string, unknown> = {};
  const headerVariants: Array<[string, Record<string, string>]> = [
    ['x-observer-token', { 'x-observer-token': cleanT, Accept: 'application/json' }],
    ['x-ops-agent-token', { 'x-ops-agent-token': cleanT, Accept: 'application/json' }],
    ['x-api-key', { 'x-api-key': cleanT, Accept: 'application/json' }],
    ['authorization-bearer', { Authorization: `Bearer ${cleanT}`, Accept: 'application/json' }],
  ];
  for (const [name, headers] of headerVariants) {
    try {
      const r = await fetch(`${cleanU}/playlists/37i9dQZF1DXcBWIGoYBM5M`, { headers });
      results[name] = { status: r.status, body: (await r.text()).slice(0, 120) };
    } catch (e) {
      results[name] = { error: String((e as any)?.message ?? e).slice(0, 120) };
    }
  }
  return new Response(JSON.stringify({
    url_first40: u.slice(0, 40),
    token_len: t.length,
    token_first8: t.slice(0, 8),
    token_last8: t.slice(-8),
    header_results: results,
  }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
