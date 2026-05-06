// ops-alerts-cron — varre métricas, heartbeats e fila e gera notificações operacionais.
// Roda via pg_cron a cada 5 min. Sem auth (chamado pela infra).
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Alert = {
  kind: string;
  type: "info" | "warning" | "error";
  title: string;
  message: string;
};

async function notifyOnce(supabase: ReturnType<typeof createClient>, alert: Alert) {
  // Dedupe: 1h por kind
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since)
    .contains("metadata", { kind: alert.kind });
  if ((count ?? 0) > 0) return false;
  try {
    await supabase.rpc("create_notification" as any, {
      p_type: alert.type,
      p_title: alert.title,
      p_message: alert.message,
      p_action_url: "/playlist-deals",
      p_metadata: { kind: alert.kind, source: "ops-alerts-cron" },
    });
    return true;
  } catch (_) {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const fired: string[] = [];
  const now = Date.now();
  const fifteenMinAgo = new Date(now - 15 * 60_000).toISOString();
  const tenMinAgo = new Date(now - 10 * 60_000).toISOString();

  // 1) Heartbeat ausente (>10 min)
  {
    const { data } = await supabase
      .from("bot_heartbeats")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1);
    const last = data?.[0]?.created_at;
    if (!last || new Date(last).getTime() < now - 10 * 60_000) {
      if (await notifyOnce(supabase, {
        kind: "ops_heartbeat_missing",
        type: "error",
        title: "Bot sem heartbeat",
        message: `Nenhum heartbeat do bot nos últimos 10 minutos. Última atividade: ${last ?? "nunca"}.`,
      })) fired.push("heartbeat_missing");
    }
  }

  // 2) Coleta travada: songs em queued há > 15min
  {
    const { count } = await supabase
      .from("curator_deal_songs")
      .select("id", { count: "exact", head: true })
      .eq("auto_collect_status", "queued")
      .lt("updated_at", fifteenMinAgo);
    if ((count ?? 0) > 0) {
      if (await notifyOnce(supabase, {
        kind: "ops_collect_stuck",
        type: "warning",
        title: "Coleta travada",
        message: `${count} música(s) presa(s) em "queued" há mais de 15 minutos.`,
      })) fired.push("collect_stuck");
    }
  }

  // 3) Timeouts em sequência: ≥3 timeouts numa mesma operation nos últimos 15min
  {
    const { data } = await supabase
      .from("ops_metrics")
      .select("operation,status")
      .gte("created_at", fifteenMinAgo)
      .eq("status", "timeout");
    const counts = new Map<string, number>();
    for (const r of data ?? []) {
      counts.set((r as any).operation, (counts.get((r as any).operation) ?? 0) + 1);
    }
    const offenders = Array.from(counts.entries()).filter(([, n]) => n >= 3);
    if (offenders.length) {
      const desc = offenders.map(([op, n]) => `${op}: ${n}`).join(", ");
      if (await notifyOnce(supabase, {
        kind: "ops_timeout_streak",
        type: "warning",
        title: "Timeouts em sequência",
        message: `Operações com 3+ timeouts em 15min: ${desc}.`,
      })) fired.push("timeout_streak");
    }
  }

  // 4) Spotify quota: ≥5 erros 429/rate_limited em 10min
  {
    const { count } = await supabase
      .from("ops_metrics")
      .select("id", { count: "exact", head: true })
      .gte("created_at", tenMinAgo)
      .eq("status", "rate_limited");
    if ((count ?? 0) >= 5) {
      if (await notifyOnce(supabase, {
        kind: "ops_spotify_quota",
        type: "warning",
        title: "Quota Spotify pressionada",
        message: `${count} chamadas rate-limited nos últimos 10 minutos.`,
      })) fired.push("spotify_quota");
    }
  }

  // 5) Fila congestionada: candidates > 50 (auto_collect=true e idle/error)
  {
    const { count } = await supabase
      .from("curator_deal_songs")
      .select("id", { count: "exact", head: true })
      .eq("auto_collect", true)
      .in("auto_collect_status", ["idle", "error"]);
    if ((count ?? 0) > 50) {
      if (await notifyOnce(supabase, {
        kind: "ops_queue_congested",
        type: "warning",
        title: "Fila de coleta congestionada",
        message: `${count} músicas aguardando coleta. Considere aumentar workers.`,
      })) fired.push("queue_congested");
    }
  }

  return jr({ ok: true, fired, at: new Date().toISOString() });
});
