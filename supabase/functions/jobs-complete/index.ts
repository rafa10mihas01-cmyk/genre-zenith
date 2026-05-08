// jobs-complete — worker reporta sucesso/falha de um job.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jr, requireAgentToken } from "../_shared/admin-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const guard = requireAgentToken(req);
  if (!guard.ok) return guard.resp;

  let body: {
    job_id?: string;
    worker_id?: string;
    status?: "completed" | "failed";
    result?: Record<string, unknown>;
    error?: string;
    force_dead?: boolean;
  } = {};
  try { body = await req.json(); } catch { return jr({ error: "invalid_json" }, 400); }

  const jobId = (body.job_id ?? "").trim();
  const workerId = (body.worker_id ?? "").trim();
  const status = body.status;
  if (!jobId || !workerId) return jr({ error: "job_id_and_worker_id_required" }, 400);
  if (status !== "completed" && status !== "failed") return jr({ error: "invalid_status" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  if (status === "completed") {
    const { data, error } = await supabase.rpc("complete_job", {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_result: body.result ?? {},
    });
    if (error) return jr({ error: error.message }, 500);
    return jr({ job: data }, 200);
  }

  const { data, error } = await supabase.rpc("fail_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_error: body.error ?? "unknown",
    p_force_dead: !!body.force_dead,
  });
  if (error) return jr({ error: error.message }, 500);
  return jr({ job: data }, 200);
});
