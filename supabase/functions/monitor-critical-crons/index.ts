// monitor-critical-crons
// Roda a cada hora via pg_cron. Verifica os crons críticos no cron_health:
// se a última execução foi há mais de 2 horas (ou nunca aconteceu),
// dispara notificação warning via RPC create_notification.
//
// Crons monitorados:
//   - playlist-queue-processor
//   - sync-managed-playlists
//   - wave1-enrich-batch
//
// Idempotência: antes de criar notificação nova, verifica se já existe
// uma notificação não-lida do mesmo cron nas últimas 6 horas — evita
// floodar o sino quando o cron fica horas/dias parado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRITICAL_CRONS = [
  "playlist-queue-processor",
  "sync-managed-playlists",
  "wave1-enrich-batch",
] as const;

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2h
const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h

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
  const dedupeCutoff = new Date(now - DEDUPE_WINDOW_MS).toISOString();
  const results: Array<{
    job: string;
    status: "ok" | "stale" | "never_ran";
    last_run: string | null;
    notified: boolean;
  }> = [];

  for (const job of CRITICAL_CRONS) {
    // 1) Última execução registrada em cron_health
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

    const lastRunIso = rows?.[0]?.ran_at ?? null;
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

    // 2) Dedupe: já existe notificação não-lida pra esse cron nas últimas 6h?
    const titleMatch = `Cron crítico inativo: ${job}`;
    const { count: existing } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("title", titleMatch)
      .eq("read", false)
      .gte("created_at", dedupeCutoff);

    if ((existing ?? 0) > 0) {
      results.push({ job, status, last_run: lastRunIso, notified: false });
      continue;
    }

    // 3) Cria notificação warning
    const body = lastRunMs
      ? `Última execução há ${Math.round((now - lastRunMs) / (60 * 60 * 1000))}h. Verifique o agendamento.`
      : `Sem registros de execução. Verifique se o cron está habilitado.`;

    const { error: notifErr } = await admin.rpc("create_notification", {
      p_title: titleMatch,
      p_body: body,
      p_severity: "warning",
      p_link: "/sistema?tab=saude",
    });

    if (notifErr) {
      console.error(`[monitor-critical-crons] notify failed for ${job}:`, notifErr);
      results.push({ job, status, last_run: lastRunIso, notified: false });
      continue;
    }

    results.push({ job, status, last_run: lastRunIso, notified: true });
  }

  // Registra a própria execução em cron_health pra observabilidade.
  await admin.from("cron_health").insert({
    job_name: "monitor-critical-crons",
    status: "ok",
    metrics: { checked: results.length, notified: results.filter((r) => r.notified).length },
  });

  return new Response(JSON.stringify({ checked_at: new Date().toISOString(), results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
});
