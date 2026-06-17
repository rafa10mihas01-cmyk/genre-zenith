// request-curator-otp — envia código de 6 dígitos pro e-mail cadastrado do curador.
// Rate limit: 3 por hora por (deal+email).
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, clientIp, rateLimitResponse } from "../_shared/rate-limit.ts";
import { template as otpTemplate } from "../_shared/transactional-email-templates/curator-access-otp.tsx";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  const ipRl = await checkRateLimit(`requestCuratorOtp:ip:${ip}`, 60, 30);
  if (!ipRl.allowed) return rateLimitResponse(corsHeaders);

  let token = "", emailRaw = "";
  try {
    const body = await req.json();
    token = String(body?.token ?? "").trim();
    emailRaw = String(body?.email ?? "").trim().toLowerCase();
  } catch { /* ignore */ }

  if (!token || token.length < 8 || !/^[a-zA-Z0-9_-]+$/.test(token)) return jr({ error: "invalid_token" }, 400);
  if (!emailRaw || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw) || emailRaw.length > 254) {
    return jr({ error: "invalid_email" }, 400);
  }

  const emailRl = await checkRateLimit(`requestCuratorOtp:em:${emailRaw}`, 3600, 3);
  if (!emailRl.allowed) {
    return jr({ error: "rate_limited", message: "Limite de 3 códigos por hora." }, 429);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: deal } = await supabase
    .from("curator_deals")
    .select("id, curator_id, curator_name, song_name, song_artist, closed_at")
    .or(`public_token.eq.${token},slug.eq.${token}`)
    .maybeSingle();
  if (!deal) return jr({ error: "not_found" }, 404);

  // Autorização: e-mail bate com o cadastrado do curador OU está na allowlist do deal
  let authorized = false;
  if (deal.curator_id) {
    const { data: curator } = await supabase
      .from("curators")
      .select("email")
      .eq("id", deal.curator_id)
      .maybeSingle();
    if (curator?.email && curator.email.trim().toLowerCase() === emailRaw) {
      authorized = true;
    }
  }
  if (!authorized) {
    const { data: allow } = await supabase
      .from("curator_deal_access_emails")
      .select("id")
      .eq("deal_id", deal.id)
      .eq("email", emailRaw)
      .maybeSingle();
    if (allow) authorized = true;
  }

  // Resposta neutra quando não autorizado.
  if (!authorized) return jr({ ok: true, sent: true });

  // Hardening 4.B.1.A: invalida códigos anteriores ainda ativos.
  await supabase
    .from("curator_access_otps")
    .update({ used_at: new Date().toISOString() })
    .eq("deal_id", deal.id)
    .eq("email", emailRaw)
    .is("used_at", null);

  const code = genCode();
  const { error: insErr } = await supabase
    .from("curator_access_otps")
    .insert({ deal_id: deal.id, email: emailRaw, code });
  if (insErr) return jr({ error: insErr.message }, 500);

  const messageId = crypto.randomUUID();
  const templateData = {
    code,
    curator_name: deal.curator_name,
    song_name: deal.song_name,
    song_artist: deal.song_artist,
  };

  let html: string, text: string;
  try {
    html = await renderAsync(React.createElement(otpTemplate.component, templateData));
    text = await renderAsync(React.createElement(otpTemplate.component, templateData), { plainText: true });
  } catch (e) {
    console.error("render template failed", e);
    return jr({ error: "template_render_failed" }, 500);
  }

  const subject = typeof otpTemplate.subject === "function"
    ? otpTemplate.subject(templateData)
    : otpTemplate.subject;

  // Lovable Email API exige unsubscribe_token
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
    if (tokErr) return jr({ error: "token_create_failed", message: tokErr.message }, 500);
    const { data: stored } = await supabase
      .from("email_unsubscribe_tokens")
      .select("token")
      .eq("email", emailRaw)
      .maybeSingle();
    unsubscribeToken = stored?.token ?? newTok;
  } else {
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
      label: "curator-access-otp",
      idempotency_key: `curator-otp:${deal.id}:${emailRaw}:${code}`,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  });

  if (enqErr) {
    console.error("enqueue failed", enqErr);
    await supabase.from("email_send_log").insert({
      message_id: messageId,
      template_name: "curator-access-otp",
      recipient_email: emailRaw,
      status: "failed",
      error_message: `enqueue failed: ${enqErr.message}`.slice(0, 1000),
    });
    return jr({ error: "enqueue_failed", message: enqErr.message }, 500);
  }

  await supabase.from("email_send_log").insert({
    message_id: messageId,
    template_name: "curator-access-otp",
    recipient_email: emailRaw,
    status: "pending",
  });

  return jr({ ok: true, sent: true });
});
