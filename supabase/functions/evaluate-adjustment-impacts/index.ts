import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { serveCron } from "../_shared/cron-lock.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serveCron({ job_name: "evaluate-adjustment-impacts", max_retries: 1, timeout_ms: 240_000 }, async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const startedAt = Date.now();

  try {
    const { data, error } = await supabase.rpc("evaluate_pending_impacts");
    if (error) throw error;

    await reportCronHealth(supabase, {
      job_name: "evaluate-adjustment-impacts",
      status: "ok",
      startedAt,
      metrics: { evaluated: data ?? 0 },
    });

    return new Response(
      JSON.stringify({ ok: true, evaluated: data ?? 0, at: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("evaluate-adjustment-impacts error", e);
    await reportCronHealth(supabase, {
      job_name: "evaluate-adjustment-impacts",
      status: "error",
      startedAt,
      message: (e as Error).message,
    });
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
