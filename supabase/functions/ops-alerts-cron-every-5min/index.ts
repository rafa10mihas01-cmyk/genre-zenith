import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serveCron } from "../_shared/cron-lock.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serveCron({ job_name: "ops-alerts-cron-every-5min", max_retries: 0, timeout_ms: 240_000 }, async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const alerts: any[] = [];

  try {
    // Latest heartbeat per bot_name
    const { data: hbs, error } = await supabase
      .from("bot_heartbeats")
      .select("bot_name, status, last_collect_at, created_at, hostname, worker_id")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    const latestByBot = new Map<string, any>();
    for (const h of hbs ?? []) {
      if (!latestByBot.has(h.bot_name)) latestByBot.set(h.bot_name, h);
    }

    const now = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;

    for (const hb of latestByBot.values()) {
      const dedupe_key = `bot_silent:${hb.bot_name}`;

      if (hb.status !== "online" || !hb.last_collect_at) {
        // Bot voltou ao normal → fecha alerta aberto, se existir
        await supabase.rpc("resolve_notifications_by_dedupe" as any, {
          p_dedupe_key: dedupe_key,
          p_resolution_message: "Robô voltou ao estado normal.",
        });
        continue;
      }
      const lastCollectMs = new Date(hb.last_collect_at).getTime();
      const ageMs = now - lastCollectMs;
      if (ageMs <= ONE_HOUR_MS) {
        await supabase.rpc("resolve_notifications_by_dedupe" as any, {
          p_dedupe_key: dedupe_key,
          p_resolution_message: "Robô voltou a coletar normalmente.",
        });
        continue;
      }

      const hours = Math.floor(ageMs / ONE_HOUR_MS);
      const title = "Robô parado sem coletar";
      const message =
        `O robô "${hb.bot_name}" está ativo mas não coleta há ${hours} hora${hours === 1 ? "" : "s"}. ` +
        `Impacto: a fila do Spotify pode estar travada. ` +
        `Ação: verifique a aba Saúde do sistema.`;

      const { error: insErr } = await supabase.rpc("create_notification" as any, {
        p_type: "warning",
        p_title: title,
        p_message: message,
        p_action_url: "/sistema?tab=saude",
        p_metadata: {
          domain: "bot",
          severity: "medium",
          kind: "bot_silent",
          action_required: true,
          bot_name: hb.bot_name,
          hostname: hb.hostname,
          worker_id: hb.worker_id,
          hours_silent: hours,
        },
        p_dedupe_key: dedupe_key,
        p_cooldown_minutes: 360, // 6h
      });
      if (insErr) {
        console.error("notify failed", insErr);
        continue;
      }
      alerts.push({ bot: hb.bot_name, hours });
    }

    // ============================================================
    // Monitor de VPS heartbeat — vps_nodes.last_heartbeat_at
    // ============================================================
    const VPS_OFFLINE_MS = 15 * 60 * 1000; // 15min sem heartbeat = offline
    const { data: vpsRows } = await supabase
      .from("vps_nodes")
      .select("id, hostname, status, last_heartbeat_at");

    for (const v of vpsRows ?? []) {
      const dedupe_key = `vps_offline:${v.id}`;
      const lastMs = v.last_heartbeat_at ? new Date(v.last_heartbeat_at as string).getTime() : null;
      const ageMs = lastMs != null ? now - lastMs : null;
      const isOffline = lastMs == null || (ageMs != null && ageMs > VPS_OFFLINE_MS);

      if (!isOffline) {
        await supabase.rpc("resolve_notifications_by_dedupe" as any, {
          p_dedupe_key: dedupe_key,
          p_resolution_message: `VPS ${v.hostname ?? v.id} voltou a responder.`,
        });
        continue;
      }

      const mins = ageMs != null ? Math.floor(ageMs / 60000) : null;
      const ageLabel = mins == null
        ? "nunca enviou heartbeat"
        : mins < 60
          ? `há ${mins} minutos`
          : `há ${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`;

      await supabase.rpc("create_notification" as any, {
        p_type: "critical",
        p_title: `VPS ${v.hostname ?? v.id} fora do ar`,
        p_message:
          `A VPS "${v.hostname ?? v.id}" não envia heartbeat ${ageLabel}. ` +
          `Impacto: o robô parou de coletar e executar jobs. ` +
          `Ação: verifique PM2/SSH na VPS e reinicie o processo do bot.`,
        p_action_url: "/sistema?tab=saude",
        p_metadata: {
          domain: "bot",
          severity: "critical",
          kind: "vps_offline",
          action_required: true,
          vps_id: v.id,
          hostname: v.hostname,
          last_heartbeat_at: v.last_heartbeat_at,
          minutes_silent: mins,
        },
        p_dedupe_key: dedupe_key,
        p_cooldown_minutes: 60,
      });
      alerts.push({ vps: v.hostname ?? v.id, minutes_silent: mins });
    }

    await reportCronHealth(supabase, {
      job_name: "ops-alerts-cron-every-5min",
      status: "ok",
      startedAt,
      metrics: { alerts_emitted: alerts.length },
      message: `alerts=${alerts.length}`,
    });
    return new Response(JSON.stringify({ ok: true, alerts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ops-alerts-cron error", e);
    await reportCronHealth(supabase, {
      job_name: "ops-alerts-cron-every-5min",
      status: "error",
      startedAt,
      message: String(e),
    });
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
