// client-approve-campaign — wrapper público da RPC `client_approve_campaign`.
// Aplica rate limit 120 req/min por IP e injeta o IP real do cliente no RPC.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, clientIp, rateLimitResponse } from "../_shared/rate-limit.ts";
import { gateCampaignAccess } from "../_shared/portal-auth.ts";

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
  const rl = await checkRateLimit(`client-approve-campaign:${ip}`, 60, 120);
  if (!rl.allowed) return rateLimitResponse(corsHeaders);

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const approverName = typeof body?.approver_name === "string" ? body.approver_name.trim() : "";
    if (!token || token.length < 6) return jr({ ok: false, error: "token obrigatório" }, 400);
    if (approverName.length < 2) return jr({ ok: false, error: "approver_name obrigatório" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Gate por PIN — se a campanha tem e-mails autorizados, exige JWT.
    const { data: camp } = await admin
      .from("campaigns")
      .select("id")
      .eq("public_plan_token", token)
      .maybeSingle();
    if (!camp) return jr({ ok: false, error: "not_found" }, 404);
    const gate = await gateCampaignAccess(req, admin, camp.id);
    if (!gate.ok) return jr({ ok: false, error: gate.error }, gate.status ?? 401);

    const { error } = await admin.rpc("client_approve_campaign", {
      p_token: token,
      p_approver_name: approverName,
      p_approver_ip: ip === "unknown" ? null : ip,
    });
    if (error) return jr({ ok: false, error: error.message }, 400);
    return jr({ ok: true });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
