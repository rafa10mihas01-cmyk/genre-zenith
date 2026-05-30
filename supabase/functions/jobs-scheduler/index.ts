// jobs-scheduler — Router chamado pelo VPS scheduler (PM2: nexengine-scheduler).
// Recebe { scope: "main" | "retry" | "print" } e delega para o cron apropriado.
// Auth: header x-agent-token === OPS_AGENT_TOKEN.
//
// Substitui a função antiga `jobs-scheduler` que havia sido removida — o VPS
// estava tomando 404 em todos os ticks, fazendo com que `scope:print` (que
// recupera spotify.print_batch travados) nunca rodasse, causando coletas sem
// screenshot agregado.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-agent-token, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPS_AGENT_TOKEN = Deno.env.get("OPS_AGENT_TOKEN") ?? "";

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callInternal(fnName: string): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ source: "jobs-scheduler" }),
    });
    const body = await r.text();
    return { ok: r.ok, status: r.status, body: body.slice(0, 500) };
  } catch (e) {
    return { ok: false, status: 0, body: String((e as Error)?.message ?? e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method not allowed" }, 405);

  // Auth: aceita x-agent-token OU service role Authorization (chamadas internas)
  const agentToken = (req.headers.get("x-agent-token") ?? "").trim();
  const authHeader = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const isAgent = OPS_AGENT_TOKEN && agentToken === OPS_AGENT_TOKEN;
  const isService = authHeader && authHeader === SERVICE_KEY;
  if (!isAgent && !isService) {
    const mask = (s: string) =>
      s.length === 0
        ? "<empty>"
        : `len=${s.length} prefix=${s.slice(0, 4)} suffix=${s.slice(-4)}`;
    console.log(
      JSON.stringify({
        evt: "auth_fail",
        sent_agent: mask(agentToken),
        env_agent: mask(OPS_AGENT_TOKEN),
        sent_auth: mask(authHeader),
        env_service_len: SERVICE_KEY.length,
      }),
    );
    return jr({ error: "unauthorized" }, 401);
  }

  let payload: { scope?: string; source?: string; agent_id?: string } = {};
  try {
    payload = await req.json();
  } catch {
    // body vazio é ok
  }
  const scope = (payload.scope ?? "").toLowerCase();
  const t0 = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let result: Record<string, unknown> = { scope, dispatched: [] as string[] };

  try {
    if (scope === "print") {
      const r = await callInternal("cron-recover-print-batches");
      result = { ...result, dispatched: ["cron-recover-print-batches"], target_status: r.status, target_ok: r.ok };
    } else if (scope === "retry") {
      const r = await callInternal("reap-zombie-jobs");
      result = { ...result, dispatched: ["reap-zombie-jobs"], target_status: r.status, target_ok: r.ok };
    } else if (scope === "main") {
      // Coleta principal: por ora apenas no-op (jobs spotify.deal.collect são
      // criados por outros fluxos). Mantemos 200 OK para o VPS não logar erro.
      result = { ...result, noop: true };
    } else {
      return jr({ error: `scope inválido: '${scope}' (use main|retry|print)` }, 400);
    }

    // Log leve para auditoria
    await supabase.from("collection_logs").insert({
      acao: `jobs_scheduler_${scope}`,
      status: "ok",
      mensagem: JSON.stringify({ ...result, duration_ms: Date.now() - t0, source: payload.source ?? null }),
    }).then(() => {}).catch(() => {});

    return jr({ ok: true, duration_ms: Date.now() - t0, ...result });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    await supabase.from("collection_logs").insert({
      acao: `jobs_scheduler_${scope}`,
      status: "error",
      mensagem: msg.slice(0, 500),
    }).then(() => {}).catch(() => {});
    return jr({ error: msg }, 500);
  }
});
