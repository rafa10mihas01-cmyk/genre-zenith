// jobs-claim — worker chama para reservar próximo job da fila.
// Auth: x-agent-token (compartilhado com o agente VPS).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jr, requireAgentToken } from "../_shared/admin-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const guard = requireAgentToken(req);
  if (!guard.ok) return guard.resp;

  let body: { worker_id?: string; job_types?: string[]; lease_seconds?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const workerId = (body.worker_id ?? "").trim();
  if (!workerId) return jr({ error: "worker_id_required" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await supabase.rpc("claim_next_job", {
    p_worker_id: workerId,
    p_job_types: body.job_types ?? null,
    p_lease_seconds: body.lease_seconds ?? 300,
  });

  if (error) return jr({ error: error.message }, 500);
  // claim_next_job retorna RECORD jobs_queue — quando não há job, devolve uma
  // linha com TODAS as colunas NULL (não NULL puro). Normalizamos aqui.
  const job = data && typeof data === "object" && (data as any).id ? data : null;
  return jr({ job }, 200);
});
