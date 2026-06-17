// check-curator-access — diz se o portal do curador exige OTP.
// Regra: se o deal está ligado a um curador (curators row via curator_id)
// E esse curador tem email cadastrado → exige verificação.
// Senão, abre livre (legado).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
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
  const rl = await checkRateLimit(`check-curator-access:${ip}`, 60, 120);
  if (!rl.allowed) return rateLimitResponse(corsHeaders);

  let token = "";
  try {
    const body = await req.json();
    token = String(body?.token ?? "").trim();
  } catch { /* ignore */ }

  if (!token || token.length < 8 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
    return jr({ ok: false, error: "invalid_token" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // token pode ser slug OU public_token
  const { data: deal } = await admin
    .from("curator_deals")
    .select("id, curator_id")
    .or(`public_token.eq.${token},slug.eq.${token}`)
    .maybeSingle();

  if (!deal) return jr({ ok: false, error: "not_found" }, 404);

  // Hardening 4.B.1.A: portal exige OTP se há allowlist (deal_access_emails)
  // OU o curador ligado tem e-mail cadastrado.
  const [{ count: emails }, curatorRes] = await Promise.all([
    admin
      .from("curator_deal_access_emails")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", deal.id),
    deal.curator_id
      ? admin.from("curators").select("email").eq("id", deal.curator_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const curEmail = (curatorRes as { data: { email?: string | null } | null })?.data?.email ?? null;
  const required = (emails ?? 0) > 0 || !!(curEmail && curEmail.trim());

  return jr({ ok: true, required });
});
