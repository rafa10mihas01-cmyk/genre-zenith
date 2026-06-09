import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reportCronHealth } from "../_shared/cron-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
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
