// portal-auth-debug — log temporário de diagnóstico do gate do portal do cliente.
// Fire-and-forget: aceita qualquer payload, registra em console (visível nos logs
// da Edge Function) e retorna 204. Não persiste em tabela pra evitar custo de
// migration nessa fase; basta ler os logs em tempo real durante a investigação.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("method_not_allowed", { status: 405, headers: corsHeaders });
  }
  try {
    const body = await req.json().catch(() => ({}));
    // Truncamos user_agent pra não poluir logs.
    const ua = typeof body?.user_agent === "string" ? body.user_agent.slice(0, 200) : null;
    console.log("[portal_auth_debug]", JSON.stringify({
      campaign_id: body?.campaign_id ?? null,
      email: body?.email ?? null,
      endpoint: body?.endpoint ?? null,
      auth_status: body?.auth_status ?? null,
      jwt_present: Boolean(body?.jwt_present),
      localstorage_available: Boolean(body?.localstorage_available),
      token: body?.token ?? null,
      user_agent: ua,
      timestamp: body?.timestamp ?? new Date().toISOString(),
    }));
  } catch (err) {
    console.error("[portal_auth_debug] parse_error", err);
  }
  return new Response(null, { status: 204, headers: corsHeaders });
});
