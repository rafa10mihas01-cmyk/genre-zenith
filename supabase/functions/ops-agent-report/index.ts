// ops-agent-report — agente VPS reporta métricas/heartbeat e (opcionalmente) updates de comando.
// Como ops_agent_commands não existe neste backend, command_update é aceito mas ignorado (200 ok).
// Métricas reais são gravadas em bot_heartbeats (tabela existente).
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireAgentToken, corsHeaders, jr } from "../_shared/admin-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = requireAgentToken(req);
  if (!guard.ok) return guard.resp;

  let body: any;
  try { body = await req.json(); } catch { return jr({ error: "invalid_json" }, 400); }

  const kind = body.type ?? "command_update";

  if (kind === "metrics") {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const m = body.metrics ?? {};
    const { error } = await supabase.from("bot_heartbeats").insert({
      bot_name: body.bot_name ?? "vps-agent",
      status: "online",
      hostname: body.hostname ?? null,
      worker_id: body.agent_id ?? "default",
      message: body.message ?? null,
      cpu_percent: m.cpu_percent ?? null,
      mem_percent: m.mem_percent ?? null,
      mem_used_mb: m.mem_used_mb ?? null,
      mem_total_mb: m.mem_total_mb ?? null,
      swap_percent: m.swap_percent ?? null,
      disk_percent: m.disk_percent ?? null,
      disk_used_gb: m.disk_used_gb ?? null,
      disk_total_gb: m.disk_total_gb ?? null,
      uptime_seconds: m.uptime_seconds ?? null,
      load_avg: m.load_avg ?? null,
      pm2_processes: m.pm2_processes ?? null,
      chrome_instances: m.chrome_instances ?? null,
      agent_version: body.agent_version ?? null,
      metadata: body.extra ?? {},
    });
    if (error) return jr({ error: error.message }, 500);
    return jr({ ok: true }, 200);
  }

  if (kind === "command_update") {
    // Sem ops_agent_commands neste backend — aceita silenciosamente.
    return jr({ ok: true, ignored: "ops_agent_commands_not_provisioned" }, 200);
  }

  return jr({ error: "unknown_type", type: kind }, 400);
});
