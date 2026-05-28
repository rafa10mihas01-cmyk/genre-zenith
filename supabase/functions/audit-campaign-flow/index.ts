// audit-campaign-flow — read-only auditoria das 7 invariantes do fluxo de campanha.
// POST { campaign_id: uuid } → { campaign_id, ok, steps[] }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { auditCampaignFlow } from "../_shared/audit-campaign.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: { campaign_id?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  if (!body.campaign_id || typeof body.campaign_id !== "string") {
    return json({ ok: false, error: "missing_campaign_id" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const report = await auditCampaignFlow(admin, body.campaign_id);
    return json(report);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
