// check-campaign-access — endpoint público que diz se o portal de uma
// campanha exige PIN (modelo opt-in por campanha).
//
// Regra: se a campanha tem AO MENOS 1 e-mail registrado em
// `campaign_access_emails`, o portal exige verificação por e-mail+OTP.
// Se não tem nenhum, o portal abre só com o token na URL (comportamento
// legado — não quebra links já enviados).
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
  const rl = await checkRateLimit(`check-campaign-access:${ip}`, 60, 120);
  if (!rl.allowed) return rateLimitResponse(corsHeaders);

  let token = "";
  try {
    const body = await req.json();
    token = String(body?.token ?? "").trim();
  } catch { /* ignore */ }

  if (!token || token.length < 16 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
    return jr({ ok: false, error: "invalid_token" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const { data: camp } = await admin
    .from("campaigns")
    .select("id")
    .eq("public_plan_token", token)
    .maybeSingle();

  if (!camp) return jr({ ok: false, error: "not_found" }, 404);

  // OTP gate temporariamente desabilitado — portal abre só com token.
  return jr({ ok: true, required: false });
});
