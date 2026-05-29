// recalc-curator-performance — recalcula performance_score de todos os curadores baseado em 90 dias de deals.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const incoming = req.headers.get("x-cron-secret");
  if (CRON_SECRET && incoming && incoming !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await supabase.rpc("recalc_curator_performance_scores");
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, updated: (data ?? []).length, ran_at: new Date().toISOString() }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
