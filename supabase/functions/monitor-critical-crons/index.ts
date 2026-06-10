// monitor-critical-crons
// Roda a cada hora via pg_cron. Verifica:
//   1) Crons críticos em cron_health (alerta se "stale" > 2h)
//   2) Spotify circuit breakers (alerta se "open")
//   3) Spotify 403 em massa por app (alerta se > THRESHOLD em 1h)
//
// Dedupe: usa p_dedupe_key + p_cooldown_minutes nativos da RPC
// (cooldown de 6h por cron para não floodar o sino).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRITICAL_CRONS = [
  "playlist-queue-processor",
  "sync-managed-playlists",
  "process-email-queue",
  "execution-planner",
  "reap-zombie-jobs",
  "ops-alerts-cron-every-5min",
] as const;

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2h
const COOLDOWN_MINUTES = 6 * 60; // 6h entre re-notificações
const SPOTIFY_403_THRESHOLD = 100; // 403s em 1h por app → alerta
const SPOTIFY_403_WINDOW_MS = 60 * 60 * 1000;


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
    // Fonte de verdade: pg_cron job_run_details (último sucesso HTTP do scheduler).
    // Fallback: cron_health (heartbeat manual escrito por algumas funções).
    const { data: lastSuccessIso, error: rpcErr } = await admin.rpc(
      "get_cron_last_success" as any,
      { p_fn_name: job },
    );
    let lastRunIso: string | null = (lastSuccessIso as string | null) ?? null;

    if (!lastRunIso) {
      const { data: rows } = await admin
        .from("cron_health")
        .select("ran_at")
        .eq("job_name", job)
        .order("ran_at", { ascending: false })
        .limit(1);
      lastRunIso = (rows?.[0]?.ran_at as string | undefined) ?? null;
    }

    if (rpcErr) {
      console.error(`[monitor-critical-crons] rpc failed for ${job}:`, rpcErr);
    }

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
      "process-email-queue": "Envio de e-mails",
      "execution-planner": "Planejamento de execução",
      "reap-zombie-jobs": "Limpeza de jobs travados",
      "ops-alerts-cron-every-5min": "Monitor de robôs",
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

  // ============================================================
  // Spotify 403 em massa por app — sinaliza escopo perdido / playlist alheia
  // ============================================================
  try {
    const sinceIso = new Date(Date.now() - SPOTIFY_403_WINDOW_MS).toISOString();
    // FASE APP-03: ignora 403 de endpoints de descoberta restritos pelo Spotify
    // (/v1/tracks e /v1/users/{id}/playlists). Esses 403s são quota/política da
    // plataforma, não falha de escopo do app — não devem gerar incidente.
    const { data: rows } = await admin
      .from("spotify_call_log")
      .select("app_id, endpoint")
      .eq("http_status", 403)
      .gte("created_at", sinceIso);

    const isRestricted = (ep: string | null): boolean => {
      if (!ep) return false;
      if (ep === "api.spotify.com/v1/tracks") return true;
      if (ep === "api.spotify.com/v1/tracks/:id") return true;
      if (/^api\.spotify\.com\/v1\/users\/[^/]+\/playlists\/?$/.test(ep)) return true;
      return false;
    };

    const counts = new Map<string, number>();
    for (const r of rows ?? []) {
      const id = (r as any).app_id as string | null;
      const ep = (r as any).endpoint as string | null;
      if (!id) continue;
      if (isRestricted(ep)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    // Resolve apps que NÃO estão mais em excesso
    const { data: appsAll } = await admin.from("spotify_apps").select("id, name");
    for (const app of appsAll ?? []) {
      const n = counts.get(app.id) ?? 0;
      const dedupe = `spotify_403_excess:${app.id}`;
      if (n >= SPOTIFY_403_THRESHOLD) {
        await admin.rpc("create_notification", {
          p_type: "critical",
          p_title: `App Spotify ${app.name ?? ""} com excesso de erros de permissão`,
          p_message:
            `${n} chamadas Spotify recusadas (HTTP 403) na última hora para o app "${app.name ?? app.id}". ` +
            `Impacto: o app pode ter perdido escopo OAuth ou estar tentando agir em playlists alheias. ` +
            `Ação: revise as contas/playlists vinculadas a este app.`,
          p_action_url: "/sistema?tab=saude",
          p_metadata: {
            domain: "system",
            severity: "high",
            kind: "spotify_403_excess",
            action_required: true,
            app_id: app.id,
            app_name: app.name,
            count_1h: n,
          },
          p_dedupe_key: dedupe,
          p_cooldown_minutes: 360,
        });
      } else {
        await admin.rpc("resolve_notifications_by_dedupe" as any, {
          p_dedupe_key: dedupe,
          p_resolution_message: "Erros 403 normalizaram.",
        });
      }
    }
  } catch (e) {
    console.error("[monitor-critical-crons] 403 check failed:", e);
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
