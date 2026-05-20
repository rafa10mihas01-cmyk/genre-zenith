import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
      if (hb.status !== "online") continue;
      if (!hb.last_collect_at) continue;
      const lastCollectMs = new Date(hb.last_collect_at).getTime();
      const ageMs = now - lastCollectMs;
      if (ageMs <= ONE_HOUR_MS) continue;

      const hours = Math.floor(ageMs / ONE_HOUR_MS);
      const bucket = Math.floor(ageMs / ONE_HOUR_MS); // dedupe per hourly bucket
      const dedupe_key = `bot_silent:${hb.bot_name}:${bucket}h`;

      // Skip if already inserted in last 6h with same dedupe_key
      const sinceIso = new Date(now - 6 * ONE_HOUR_MS).toISOString();
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("metadata->>dedupe_key", dedupe_key)
        .gte("created_at", sinceIso)
        .limit(1);
      if (existing && existing.length > 0) continue;

      const title = "Bot online mas sem coletar";
      const message = `${hb.bot_name} está online mas sem coletar há ${hours}h (último: ${new Date(hb.last_collect_at).toISOString()})`;

      const { error: insErr } = await supabase.from("notifications").insert({
        type: "warning",
        title,
        message,
        action_url: "/sistema?tab=saude",
        metadata: {
          dedupe_key,
          domain: "sistema",
          kind: "bot_silent",
          bot_name: hb.bot_name,
          hostname: hb.hostname,
          worker_id: hb.worker_id,
          last_collect_at: hb.last_collect_at,
          hours_silent: hours,
        },
      });
      if (insErr) {
        console.error("insert notification failed", insErr);
        continue;
      }
      alerts.push({ bot: hb.bot_name, hours });
    }

    return new Response(JSON.stringify({ ok: true, alerts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ops-alerts-cron error", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
