// Public endpoint: gera código OTP de 6 dígitos pro portal do cliente.
// Valida que o e-mail está autorizado pra campanha (campaign_access_emails).
// Rate limit: 10 pedidos por e-mail+campanha por hora.
//
// Envio do email: renderiza o template e enfileira DIRETO via rpc('enqueue_email'),
// sem passar pelo gateway de send-transactional-email (que rejeita com
// UNAUTHORIZED_INVALID_JWT_FORMAT quando o service-role key não é JWT).
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, clientIp, rateLimitResponse } from "../_shared/rate-limit.ts";
import { template as otpTemplate } from "../_shared/transactional-email-templates/campaign-access-otp.tsx";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Mesmas constantes que send-transactional-email usa.
const SITE_NAME = "NexEngine";
const SENDER_DOMAIN = "notify.engine.nexcreatorx.com";
const FROM_DOMAIN = "notify.engine.nexcreatorx.com";
const FROM_LOCAL_PART = "parcerias";

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

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: camp, error: cErr } = await supabase
    .from("campaigns")
    .select("id, status, track_name, artist, client_id")
    .eq("public_plan_token", token)
    .maybeSingle();
  if (cErr) return jr({ error: cErr.message }, 500);
  if (!camp) return jr({ error: "not_found" }, 404);
  if (camp.status === "completed") return jr({ error: "campaign_closed" }, 404);

  const emailRl = await checkRateLimit(`requestCampaignOtp:em:${camp.id}:${emailRaw}`, 3600, 10);
  if (!emailRl.allowed) {
    return jr({ error: "rate_limited", message: "Limite de códigos por hora. Tente mais tarde." }, 429);
  }

  // Autorização: (a) email está em campaign_access_emails OU
  // (b) bate com o email do cliente dono da campanha (clients.email).
  let authorized = false;
  const { data: authedRow } = await supabase
    .from("campaign_access_emails")
    .select("id")
    .eq("campaign_id", camp.id)
    .ilike("email", emailRaw)
    .maybeSingle();
  if (authedRow) authorized = true;

  if (!authorized && camp.client_id) {
    const { data: client } = await supabase
      .from("clients")
      .select("email")
      .eq("id", camp.client_id)
      .maybeSingle();
    if (client?.email && client.email.trim().toLowerCase() === emailRaw) {
      authorized = true;
    }
  }

  // Resposta NEUTRA quando não autorizado — não vaza se o e-mail existe.
  if (!authorized) {
    return jr({ ok: true, sent: true });
  }

  // Hardening 4.B.1.A: invalida códigos anteriores ainda ativos pra mesma
  // (campanha, email) — assim o reenvio realmente substitui o código anterior.
  await supabase
    .from("campaign_access_otps")
    .update({ used_at: new Date().toISOString() })
    .eq("campaign_id", camp.id)
    .eq("email", emailRaw)
    .is("used_at", null);

  const code = genCode();
  const { error: insErr } = await supabase
    .from("campaign_access_otps")
    .insert({ campaign_id: camp.id, email: emailRaw, code });
  if (insErr) return jr({ error: insErr.message }, 500);

  // Renderiza o template e enfileira direto no pgmq via RPC.
  // OTPs são transacionais críticos (token de 10min) — não checamos suppression
  // nem geramos token de unsubscribe.
  const messageId = crypto.randomUUID();
  const templateData = { code, track_name: camp.track_name, artist: camp.artist };

  let html: string, text: string;
  try {
    html = await renderAsync(React.createElement(otpTemplate.component, templateData));
    text = await renderAsync(React.createElement(otpTemplate.component, templateData), { plainText: true });
  } catch (e) {
    console.error("Failed to render OTP template", e);
    return jr({ error: "template_render_failed" }, 500);
  }

  const subject = typeof otpTemplate.subject === "function"
    ? otpTemplate.subject(templateData)
    : otpTemplate.subject;

  // Lovable Email API exige unsubscribe_token para emails transacionais.
  // Reusa token existente do destinatário ou cria um novo.
  let unsubscribeToken: string | null = null;
  const { data: existingTok } = await supabase
    .from("email_unsubscribe_tokens")
    .select("token, used_at")
    .eq("email", emailRaw)
    .maybeSingle();

  if (existingTok && !existingTok.used_at) {
    unsubscribeToken = existingTok.token;
  } else if (!existingTok) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const newTok = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const { error: tokErr } = await supabase
      .from("email_unsubscribe_tokens")
      .upsert({ token: newTok, email: emailRaw }, { onConflict: "email", ignoreDuplicates: true });
    if (tokErr) {
      console.error("unsubscribe token upsert failed", tokErr);
      return jr({ error: "token_create_failed", message: tokErr.message }, 500);
    }
    const { data: stored } = await supabase
      .from("email_unsubscribe_tokens")
      .select("token")
      .eq("email", emailRaw)
      .maybeSingle();
    unsubscribeToken = stored?.token ?? newTok;
  } else {
    // Token usado: destinatário descadastrou. Aborta envio.
    console.warn("OTP requested for unsubscribed email", { emailRaw });
    return jr({ ok: true, sent: true });
  }

  const { error: enqErr } = await supabase.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload: {
      message_id: messageId,
      to: emailRaw,
      from: `${SITE_NAME} <${FROM_LOCAL_PART}@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text,
      purpose: "transactional",
      label: "campaign-access-otp",
      idempotency_key: `campaign-otp:${camp.id}:${emailRaw}:${code}`,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  });

  if (enqErr) {
    console.error("enqueue_email failed for OTP", enqErr);
    await supabase.from("email_send_log").insert({
      message_id: messageId,
      template_name: "campaign-access-otp",
      recipient_email: emailRaw,
      status: "failed",
      error_message: `enqueue failed: ${enqErr.message}`.slice(0, 1000),
    });
    return jr({ error: "enqueue_failed", message: enqErr.message }, 500);
  }

  await supabase.from("email_send_log").insert({
    message_id: messageId,
    template_name: "campaign-access-otp",
    recipient_email: emailRaw,
    status: "pending",
  });

  return jr({ ok: true, sent: true });
});
