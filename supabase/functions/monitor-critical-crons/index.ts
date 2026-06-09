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
    resolved: boolean;
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

    const dedupe = `cron-stale:${job}`;

    if (!isStale) {
      // Cron voltou ao normal → fecha incidente aberto
      const { data: resolvedCount } = await admin.rpc(
        "resolve_notifications_by_dedupe" as any,
        {
          p_dedupe_key: dedupe,
          p_resolution_message: "Cron voltou a rodar normalmente.",
        },
      );
      results.push({
        job,
        status,
        last_run: lastRunIso,
        notified: false,
        resolved: Number(resolvedCount ?? 0) > 0,
      });
      continue;
    }

    const hoursIdle = lastRunMs
      ? Math.round((now - lastRunMs) / (60 * 60 * 1000))
      : null;
    const friendly = ({
      "playlist-queue-processor": "Processamento de playlists",
      "sync-managed-playlists": "Sincronização de playlists",
      "wave1-enrich-batch": "Enriquecimento Spotify",
      "execution-planner": "Planejamento de execução",
      "reap-zombie-jobs": "Limpeza de jobs travados",
    } as Record<string, string>)[job] ?? job;

    const message = hoursIdle != null
      ? `O serviço "${friendly}" não roda há ${hoursIdle} hora${hoursIdle === 1 ? "" : "s"}. ` +
        `Impacto: novas adições e coletas estão pausadas. ` +
        `Ação: verifique a aba Saúde do sistema.`
      : `O serviço "${friendly}" nunca rodou nesta instância. ` +
        `Impacto: a função pode estar desabilitada. ` +
        `Ação: verifique o agendamento.`;

    const { error: notifErr } = await admin.rpc("create_notification", {
      p_type: "critical",
      p_title: `${friendly} pausado`,
      p_message: message,
      p_action_url: "/sistema?tab=saude",
      p_metadata: {
        domain: "system",
        severity: "high",
        kind: "cron_stale",
        action_required: true,
        job,
        hours_idle: hoursIdle,
      },
      p_dedupe_key: dedupe,
      p_cooldown_minutes: COOLDOWN_MINUTES,
    });

    if (notifErr) {
      console.error(`[monitor-critical-crons] notify failed for ${job}:`, notifErr);
      results.push({ job, status, last_run: lastRunIso, notified: false, resolved: false });
      continue;
    }

    results.push({ job, status, last_run: lastRunIso, notified: true, resolved: false });
  }

  // ============================================================
  // Spotify Circuit Breaker — alerta operacional dedupado
  // ============================================================
  try {
    const { data: breakers } = await admin
      .from("spotify_circuit_breaker")
      .select("app_id, status, blocked_until, retry_after_sec");

    for (const b of breakers ?? []) {
      const dedupe = `spotify_circuit_open:${b.app_id}`;
      if (b.status === "open" && b.blocked_until) {
        const until = new Date(b.blocked_until as string);
        const hh = String(until.getHours()).padStart(2, "0");
        const mm = String(until.getMinutes()).padStart(2, "0");
        await admin.rpc("create_notification", {
          p_type: "critical",
          p_title: "Spotify pausou um aplicativo temporariamente",
          p_message:
            `O Spotify bloqueou um app por excesso de requisições. ` +
            `Impacto: novas adições estão pausadas neste app. ` +
            `Ação: nenhuma — retomada automática às ${hh}:${mm}.`,
          p_action_url: "/sistema?tab=saude",
          p_metadata: {
            domain: "system",
            severity: "high",
            kind: "spotify_circuit_open",
            action_required: false,
            app_id: b.app_id,
            blocked_until: b.blocked_until,
          },
          p_dedupe_key: dedupe,
          p_cooldown_minutes: 60,
        });
      } else {
        await admin.rpc("resolve_notifications_by_dedupe" as any, {
          p_dedupe_key: dedupe,
          p_resolution_message: "Spotify liberou o app. Adições retomadas.",
        });
      }
    }
  } catch (e) {
    console.error("[monitor-critical-crons] circuit-breaker check failed:", e);
  }

  await admin.from("cron_health").insert({
    job_name: "monitor-critical-crons",
    status: "ok",
    metrics: {
      checked: results.length,
      notified: results.filter((r) => r.notified).length,
      resolved: results.filter((r) => r.resolved).length,
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
