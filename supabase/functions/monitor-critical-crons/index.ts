// monitor-critical-crons
// Roda a cada hora via pg_cron. Verifica os crons críticos em cron_health:
// se a última execução foi há mais de 2 horas (ou nunca aconteceu),
// dispara notificação warning via RPC create_notification.
//
// Crons monitorados:
//   - playlist-queue-processor
//   - sync-managed-playlists
//   - wave1-enrich-batch
//
// Dedupe: usa p_dedupe_key + p_cooldown_minutes nativos da RPC
// (cooldown de 6h por cron para não floodar o sino).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRITICAL_CRONS = [
  "playlist-queue-processor",
  "sync-managed-playlists",
  "wave1-enrich-batch",
  "execution-planner",
  "reap-zombie-jobs",
] as const;

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2h
const COOLDOWN_MINUTES = 6 * 60; // 6h entre re-notificações

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const now = Date.now();
  const results: Array<{
    job: string;
    status: "ok" | "stale" | "never_ran";
    last_run: string | null;
    notified: boolean;
  }> = [];

  for (const job of CRITICAL_CRONS) {
    const { data: rows, error } = await admin
      .from("cron_health")
      .select("ran_at")
      .eq("job_name", job)
      .order("ran_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error(`[monitor-critical-crons] lookup failed for ${job}:`, error);
      continue;
    }

    const lastRunIso = (rows?.[0]?.ran_at as string | undefined) ?? null;
    const lastRunMs = lastRunIso ? new Date(lastRunIso).getTime() : null;
    const isStale = lastRunMs == null || now - lastRunMs > STALE_THRESHOLD_MS;
    const status: "ok" | "stale" | "never_ran" = !isStale
      ? "ok"
      : lastRunMs == null
        ? "never_ran"
        : "stale";

    if (!isStale) {
      results.push({ job, status, last_run: lastRunIso, notified: false });
      continue;
    }

    const hoursIdle = lastRunMs
      ? Math.round((now - lastRunMs) / (60 * 60 * 1000))
      : null;
    const message = hoursIdle != null
      ? `Última execução há ${hoursIdle}h. Verifique o agendamento.`
      : `Sem registros de execução. Verifique se o cron está habilitado.`;

    const { error: notifErr } = await admin.rpc("create_notification", {
      p_type: "warning",
      p_title: `Cron crítico inativo: ${job}`,
      p_message: message,
      p_action_url: "/sistema?tab=saude",
      p_metadata: { job, last_run: lastRunIso, hours_idle: hoursIdle },
      p_dedupe_key: `cron-stale:${job}`,
      p_cooldown_minutes: COOLDOWN_MINUTES,
    });

    if (notifErr) {
      console.error(`[monitor-critical-crons] notify failed for ${job}:`, notifErr);
      results.push({ job, status, last_run: lastRunIso, notified: false });
      continue;
    }

    results.push({ job, status, last_run: lastRunIso, notified: true });
  }

  await admin.from("cron_health").insert({
    job_name: "monitor-critical-crons",
    status: "ok",
    metrics: {
      checked: results.length,
      notified: results.filter((r) => r.notified).length,
    },
  });

  return new Response(
    JSON.stringify({ checked_at: new Date().toISOString(), results }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    },
  );
});
