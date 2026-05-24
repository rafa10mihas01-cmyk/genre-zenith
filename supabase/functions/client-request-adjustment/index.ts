// client-request-adjustment — wrapper público da RPC `client_request_adjustment`.
// Aplica rate limit 120 req/min por IP.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, clientIp, rateLimitResponse } from "../_shared/rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const ip = clientIp(req);
  const rl = await checkRateLimit(`client-request-adjustment:${ip}`, 60, 120);
  if (!rl.allowed) return rateLimitResponse(corsHeaders);

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const requesterName = typeof body?.requester_name === "string" && body.requester_name.trim().length > 0
      ? body.requester_name.trim()
      : null;
    if (!token || token.length < 6) return jr({ ok: false, error: "token obrigatório" }, 400);
    if (message.length < 3) return jr({ ok: false, error: "message obrigatório" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { error } = await admin.rpc("client_request_adjustment", {
      p_token: token,
      p_message: message,
      p_requester_name: requesterName,
    });
    if (error) return jr({ ok: false, error: error.message }, 400);
    return jr({ ok: true });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
