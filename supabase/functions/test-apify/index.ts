// test-apify — valida a APIFY_API_KEY chamando /users/me
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { requireTeamAccess } from "../_shared/auth.ts";

const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  const start = Date.now();

  if (!APIFY_API_KEY) {
    return new Response(JSON.stringify({
      ok: false, error: "APIFY_API_KEY não configurada", elapsed_ms: Date.now() - start,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const r = await fetch(`https://api.apify.com/v2/users/me?token=${APIFY_API_KEY}`);
    const elapsed = Date.now() - start;
    if (!r.ok) {
      const txt = await r.text();
      return new Response(JSON.stringify({
        ok: false, error: `Apify ${r.status}: ${txt.slice(0, 200)}`, elapsed_ms: elapsed,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const json = await r.json();
    const user = json?.data ?? {};
    return new Response(JSON.stringify({
      ok: true,
      elapsed_ms: elapsed,
      user: {
        username: user.username ?? null,
        email: user.email ?? null,
        plan: user.plan ?? null,
        usage_cycle_end: user.subscription?.endAt ?? null,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false, error: (e as Error).message, elapsed_ms: Date.now() - start,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
