import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const u = Deno.env.get('OBSERVER_BASE_URL') ?? '';
  const t = Deno.env.get('OBSERVER_TOKEN') ?? '';
  const codes = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
  // Tentativa de fetch real, capturando o erro literal
  let fetchErr: string | null = null;
  let fetchStatus: number | null = null;
  try {
    const cleanU = u.trim().replace(/\/+$/, '');
    const cleanT = t.replace(/[^\x21-\x7e]/g, '');
    const r = await fetch(`${cleanU}/health`, { headers: { 'X-Observer-Token': cleanT } });
    fetchStatus = r.status;
  } catch (e) {
    fetchErr = String((e as any)?.message ?? e);
  }
  return new Response(JSON.stringify({
    url_len: u.length,
    url_first40: u.slice(0, 40),
    url_codes_tail: codes(u).slice(-6),
    token_len: t.length,
    token_first8: t.slice(0, 8),
    token_last8: t.slice(-8),
    token_has_newline: /\r|\n/.test(t),
    token_has_space: / /.test(t),
    token_codes_tail: codes(t).slice(-6),
    fetchStatus,
    fetchErr,
  }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
