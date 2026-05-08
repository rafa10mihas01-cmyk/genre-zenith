// ops-agent-poll — endpoint para o agente VPS pegar próximo comando.
// Long-poll simples: o agente chama, recebe próximo comando ou 204.
// Auth: x-agent-token (secret OPS_AGENT_TOKEN).
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireAgentToken, corsHeaders, jr } from "../_shared/admin-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = requireAgentToken(req);
  if (!guard.ok) return guard.resp;

  const url = new URL(req.url);
  const agentId = url.searchParams.get("agent_id") ?? "default";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 1), 5);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Pega comandos enfileirados, marca como picked atomicamente
  const { data: candidates, error: selErr } = await supabase
    .from("ops_agent_commands")
    .select("id, kind, command, args, timeout_ms")
    .eq("agent_id", agentId)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (selErr) return jr({ error: selErr.message }, 500);
  if (!candidates || candidates.length === 0) {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const ids = candidates.map((c) => c.id);
  const { error: updErr } = await supabase
    .from("ops_agent_commands")
    .update({ status: "picked", picked_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "queued"); // race-safe
  if (updErr) return jr({ error: updErr.message }, 500);

  return jr({ commands: candidates }, 200);
});
