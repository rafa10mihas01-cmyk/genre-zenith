// reap-zombie-jobs
// Roda a cada 15min via pg_cron. Chama o RPC reap_zombie_playlist_jobs()
// para liberar jobs em 'processing' parados há mais de 5min, e loga
// o resultado em cron_health. Se reapou muitos jobs, dispara warning.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const WARN_THRESHOLD = 10; // se reapou >= 10 jobs em uma rodada, alerta

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const startedAt = Date.now();
  let reaped = 0;
  let status: "ok" | "error" = "ok";
  let errorMsg: string | null = null;

  try {
    const { data, error } = await admin.rpc("reap_zombie_playlist_jobs");
    if (error) throw error;
    reaped = typeof data === "number" ? data : Number(data ?? 0);
  } catch (e) {
    status = "error";
    errorMsg = e instanceof Error ? e.message : String(e);
    console.error("[reap-zombie-jobs] rpc failed:", errorMsg);
  }

  await admin.from("cron_health").insert({
    job_name: "reap-zombie-jobs",
    status,
    metrics: {
      reaped,
      duration_ms: Date.now() - startedAt,
      error: errorMsg,
    },
  });

  if (status === "ok" && reaped >= WARN_THRESHOLD) {
    await admin.rpc("create_notification", {
      p_type: "warning",
      p_title: `Reap de jobs zumbis alto: ${reaped}`,
      p_message:
        `Foram liberados ${reaped} jobs travados em 'processing' nesta rodada. ` +
        `Investigue o playlist-queue-processor.`,
      p_action_url: "/sistema?tab=saude",
      p_metadata: { reaped },
      p_dedupe_key: "reap-zombie-high",
      p_cooldown_minutes: 60,
    });
  }

  return new Response(
    JSON.stringify({ ok: status === "ok", reaped, error: errorMsg }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: status === "ok" ? 200 : 500,
    },
  );
});
