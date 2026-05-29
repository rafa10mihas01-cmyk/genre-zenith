// ops-agent-poll — endpoint pro agente VPS pegar próximo comando.
// Stub: tabela ops_agent_commands não existe neste backend, sempre retorna 204.
// Mantido pra impedir spam de 404 do agent legado (nexengine-ops-agent).
import { requireAgentToken, corsHeaders, jr } from "../_shared/admin-auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = requireAgentToken(req);
  if (!guard.ok) return guard.resp;

  // Sem fila de comandos ops neste backend → 204 = idle.
  return new Response(null, { status: 204, headers: corsHeaders });
});
