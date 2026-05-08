// jobs-maintenance — varre a fila: requeue de jobs travados + marca workers offline.
// Pode ser chamada por cron (pg_cron) ou pelo painel.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jr, requireAdmin } from "../_shared/admin-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Aceita admin OU service role (cron interno).
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.resp;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let lease = 600;
  let workerStaleSec = 120;
  try {
    const body = await req.json();
    if (body?.lease_seconds) lease = Number(body.lease_seconds);
    if (body?.worker_stale_seconds) workerStaleSec = Number(body.worker_stale_seconds);
  } catch { /* default */ }

  const { data: requeued, error: rqErr } = await supabase
    .rpc("requeue_stale_jobs", { p_lease_seconds: lease });
  if (rqErr) return jr({ error: rqErr.message }, 500);

  const cutoff = new Date(Date.now() - workerStaleSec * 1000).toISOString();
  const { count: offlineCount, error: woErr } = await supabase
    .from("worker_heartbeats")
    .update({ status: "offline" }, { count: "exact" })
    .lt("last_seen_at", cutoff)
    .neq("status", "offline");
  if (woErr) return jr({ error: woErr.message }, 500);

  return jr({ requeued: requeued ?? 0, workers_offline: offlineCount ?? 0 }, 200);
});
