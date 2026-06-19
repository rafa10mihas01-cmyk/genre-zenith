// resolve-legacy-token — mapeia client_token (portal antigo /campanha/:token)
// para public_plan_token (portal novo /p/plano/:token).
// Público, sem auth. Usado apenas pelo componente LegacyCampaignRedirect.
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, clientIp, rateLimitResponse } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);

  // Rate limit: 120 req/min por IP (mesmo padrão dos outros endpoints públicos).
  const ip = clientIp(req);
  const rl = await checkRateLimit(`resolveLegacyToken:${ip}`, 60, 120);
  if (!rl.allowed) return rateLimitResponse(corsHeaders);

  let body: { client_token?: string };
  try { body = await req.json(); } catch { return jr({ error: "invalid_json" }, 400); }
  const token = (body?.client_token ?? "").trim();
  if (!token) return jr({ error: "client_token required" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1) Procura primeiro em curator_deal_songs.client_token → deal → campaign
  let dealId: string | null = null;
  const { data: songRow } = await admin
    .from("curator_deal_songs")
    .select("deal_id")
    .eq("client_token", token)
    .maybeSingle();
  if (songRow?.deal_id) dealId = songRow.deal_id as string;

  // 2) Fallback: curator_deals.client_token
  if (!dealId) {
    const { data: dealRow } = await admin
      .from("curator_deals")
      .select("id")
      .eq("client_token", token)
      .maybeSingle();
    if (dealRow?.id) dealId = dealRow.id as string;
  }

  if (!dealId) return jr({ ok: false, reason: "not_found" }, 404);

  // (2026-06-19) Resolve campanha via curator_deals.campaign_id (1:N safe).
  const { data: dealCamp } = await admin
    .from("curator_deals")
    .select("campaigns:campaign_id(public_plan_token)")
    .eq("id", dealId)
    .maybeSingle();
  const camp = (dealCamp as any)?.campaigns ?? null;

  if (!camp?.public_plan_token) return jr({ ok: false, reason: "no_campaign" }, 404);
  return jr({ ok: true, public_plan_token: camp.public_plan_token });
});
