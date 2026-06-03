// mark-manual-distribution-done — admin marca um item de manual_distribution_queue
// como concluído (MANUAL_DONE) e fecha o job em playlist_execution_jobs como `done`.
// Não altera planner, cronograma, metas ou portal.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("authorization") || "";
    if (!auth) return jr({ error: "unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: uErr } = await userClient.auth.getUser();
    if (uErr || !userData?.user) return jr({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return jr({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id ?? "");
    if (!id) return jr({ error: "id obrigatório" }, 400);
    const position = body?.position != null ? Number(body.position) : null;
    const observacao = body?.observacao ? String(body.observacao).slice(0, 2000) : null;

    const { data: item, error: getErr } = await admin
      .from("manual_distribution_queue")
      .select("id, job_id, status")
      .eq("id", id)
      .maybeSingle();
    if (getErr) return jr({ error: getErr.message }, 500);
    if (!item) return jr({ error: "not_found" }, 404);
    if (item.status === "MANUAL_DONE") return jr({ ok: true, already_done: true });

    const now = new Date().toISOString();
    const { error: upErr } = await admin
      .from("manual_distribution_queue")
      .update({
        status: "MANUAL_DONE",
        completed_at: now,
        completed_by: userId,
        position: position ?? undefined,
        observacao: observacao ?? undefined,
      })
      .eq("id", id);
    if (upErr) return jr({ error: upErr.message }, 500);

    if (item.job_id) {
      await admin
        .from("playlist_execution_jobs")
        .update({ status: "done", completed_at: now, last_error: null })
        .eq("id", item.job_id);
    }

    return jr({ ok: true });
  } catch (e) {
    return jr({ error: (e as Error).message ?? String(e) }, 500);
  }
});
