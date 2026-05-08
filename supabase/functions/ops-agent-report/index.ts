// ops-agent-report — agente VPS reporta progresso/resultado de um comando.
// Também aceita métricas de servidor (heartbeat estendido).
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

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const kind = body.type ?? "command_update";

  if (kind === "metrics") {
    // Heartbeat estendido com métricas reais
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
    const { command_id, status, stdout, stderr, exit_code, started_at, finished_at, duration_ms } = body;
    if (!command_id || !status) return jr({ error: "command_id_and_status_required" }, 400);

    const patch: any = { status };
    if (stdout !== undefined) patch.stdout = String(stdout).slice(0, 100_000);
    if (stderr !== undefined) patch.stderr = String(stderr).slice(0, 100_000);
    if (exit_code !== undefined) patch.exit_code = exit_code;
    if (started_at) patch.started_at = started_at;
    if (finished_at) patch.finished_at = finished_at;
    if (duration_ms !== undefined) patch.duration_ms = duration_ms;

    const { data: cmd, error } = await supabase
      .from("ops_agent_commands")
      .update(patch)
      .eq("id", command_id)
      .select("action_log_id, status")
      .single();
    if (error) return jr({ error: error.message }, 500);

    // Espelha no ops_actions_log se houver
    if (cmd?.action_log_id && ["success", "error", "timeout", "cancelled"].includes(status)) {
      await supabase.from("ops_actions_log").update({
        status: status === "success" ? "success" : "error",
        result: { stdout: patch.stdout, exit_code: patch.exit_code },
        error: status !== "success" ? (patch.stderr ?? `Agent reported ${status}`).slice(0, 500) : null,
        duration_ms: patch.duration_ms ?? null,
        finished_at: patch.finished_at ?? new Date().toISOString(),
      }).eq("id", cmd.action_log_id);
    }
    return jr({ ok: true }, 200);
  }

  return jr({ error: "unknown_type", type: kind }, 400);
});
