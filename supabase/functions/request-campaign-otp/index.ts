// Public endpoint: gera código OTP de 6 dígitos pro portal do cliente.
// Valida que o e-mail está autorizado pra campanha (campaign_access_emails).
// Rate limit: 3 pedidos por e-mail+campanha por hora.
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

function genCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const ip = clientIp(req);
  const ipRl = await checkRateLimit(`requestCampaignOtp:ip:${ip}`, 60, 30);
  if (!ipRl.allowed) return rateLimitResponse(corsHeaders);

  let token = "", emailRaw = "";
  try {
    const body = await req.json();
    token = String(body?.token ?? "").trim();
    emailRaw = String(body?.email ?? "").trim().toLowerCase();
  } catch { /* ignore */ }

  if (!token || token.length < 16 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
    return jr({ error: "invalid_token" }, 400);
  }
  if (!emailRaw || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw) || emailRaw.length > 254) {
    return jr({ error: "invalid_email" }, 400);
  }

  const emailRl = await checkRateLimit(`requestCampaignOtp:em:${emailRaw}`, 3600, 3);
  if (!emailRl.allowed) {
    return jr({ error: "rate_limited", message: "Limite de 3 códigos por hora. Tente mais tarde." }, 429);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: camp, error: cErr } = await supabase
    .from("campaigns")
    .select("id, status, track_name, artist")
    .eq("public_plan_token", token)
    .maybeSingle();
  if (cErr) return jr({ error: cErr.message }, 500);
  if (!camp) return jr({ error: "not_found" }, 404);
  if (camp.status === "completed") return jr({ error: "campaign_closed" }, 404);

  // Verifica autorização (case-insensitive)
  const { data: authed } = await supabase
    .from("campaign_access_emails")
    .select("id")
    .eq("campaign_id", camp.id)
    .ilike("email", emailRaw)
    .maybeSingle();

  // Resposta NEUTRA quando não autorizado — não vaza se o e-mail existe.
  // O front mostra a mensagem genérica de "se autorizado, código enviado".
  if (!authed) {
    return jr({ ok: true, sent: true });
  }

  const code = genCode();
  const { error: insErr } = await supabase
    .from("campaign_access_otps")
    .insert({ campaign_id: camp.id, email: emailRaw, code });
  if (insErr) return jr({ error: insErr.message }, 500);

  // Enfileira e-mail via send-transactional-email (que enfileira no pgmq)
  try {
    await supabase.functions.invoke("send-transactional-email", {
      body: {
        template_name: "campaign-access-otp",
        to: emailRaw,
        purpose: "transactional",
        idempotency_key: `campaign-otp:${camp.id}:${emailRaw}:${code}`,
        data: { code, track_name: camp.track_name, artist: camp.artist },
      },
    });
  } catch (e) {
    console.error("Failed to enqueue OTP email", e);
    // Não revela falha pro cliente — log no servidor.
  }

  return jr({ ok: true, sent: true });
});
