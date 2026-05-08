// workers-heartbeat — worker reporta presença e métricas.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jr, requireAgentToken } from "../_shared/admin-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const guard = requireAgentToken(req);
  if (!guard.ok) return guard.resp;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return jr({ error: "invalid_json" }, 400); }

  const workerId = String(body.worker_id ?? "").trim();
  if (!workerId) return jr({ error: "worker_id_required" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const row = {
    worker_id: workerId,
    worker_kind: String(body.worker_kind ?? "spotify-artists-worker"),
    hostname: body.hostname ? String(body.hostname) : null,
    pid: body.pid ? String(body.pid) : null,
    status: ["idle", "busy", "draining", "offline", "error"].includes(String(body.status))
      ? String(body.status) : "idle",
    current_job_id: body.current_job_id ? String(body.current_job_id) : null,
    current_job_type: body.current_job_type ? String(body.current_job_type) : null,
    jobs_completed: Number(body.jobs_completed ?? 0),
    jobs_failed: Number(body.jobs_failed ?? 0),
    cpu_percent: body.cpu_percent != null ? Number(body.cpu_percent) : null,
    mem_percent: body.mem_percent != null ? Number(body.mem_percent) : null,
    uptime_seconds: body.uptime_seconds != null ? Number(body.uptime_seconds) : null,
    agent_version: body.agent_version ? String(body.agent_version) : null,
    metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
    last_seen_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("worker_heartbeats")
    .upsert(row, { onConflict: "worker_id" });

  if (error) return jr({ error: error.message }, 500);
  return jr({ ok: true }, 200);
});
