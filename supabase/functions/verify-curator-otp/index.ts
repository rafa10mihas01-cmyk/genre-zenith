// verify-curator-otp — valida código, marca usado, grava log, devolve JWT 24h.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, clientIp, rateLimitResponse } from "../_shared/rate-limit.ts";
import { signCuratorAccessJwt } from "../_shared/curator-access-jwt.ts";

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
  const rl = await checkRateLimit(`verifyCuratorOtp:ip:${ip}`, 60, 30);
  if (!rl.allowed) return rateLimitResponse(corsHeaders);

  let token = "", emailRaw = "", code = "";
  try {
    const body = await req.json();
    token = String(body?.token ?? "").trim();
    emailRaw = String(body?.email ?? "").trim().toLowerCase();
    code = String(body?.code ?? "").trim();
  } catch { /* ignore */ }

  if (!token || token.length < 8 || !/^[a-zA-Z0-9_-]+$/.test(token)) return jr({ error: "invalid_token" }, 400);
  if (!emailRaw || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw)) return jr({ error: "invalid_email" }, 400);
  if (!/^\d{6}$/.test(code)) return jr({ error: "invalid_code" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: deal } = await supabase
    .from("curator_deals")
    .select("id")
    .or(`public_token.eq.${token},slug.eq.${token}`)
    .maybeSingle();
  if (!deal) return jr({ error: "not_found" }, 404);

  const tryRl = await checkRateLimit(`verifyCuratorOtp:try:${deal.id}:${emailRaw}`, 3600, 20);
  if (!tryRl.allowed) return jr({ error: "too_many_attempts" }, 429);

  // Hardening 4.B.1.A: busca OTP ativo MAIS RECENTE pra contar tentativas falhas.
  const nowIso = new Date().toISOString();
  const { data: activeOtp } = await supabase
    .from("curator_access_otps")
    .select("id, code, expires_at, used_at, failed_attempts, blocked_at")
    .eq("deal_id", deal.id)
    .eq("email", emailRaw)
    .is("used_at", null)
    .is("blocked_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!activeOtp) return jr({ error: "invalid_or_expired" }, 401);

  if (activeOtp.code !== code) {
    const newAttempts = (activeOtp.failed_attempts ?? 0) + 1;
    const patch: Record<string, unknown> = { failed_attempts: newAttempts };
    if (newAttempts >= 5) patch.blocked_at = nowIso;
    await supabase.from("curator_access_otps").update(patch).eq("id", activeOtp.id);
    return jr({ error: "invalid_or_expired" }, 401);
  }

  await supabase
    .from("curator_access_otps")
    .update({ used_at: nowIso })
    .eq("id", activeOtp.id);

  await supabase
    .from("curator_access_logs")
    .insert({ deal_id: deal.id, email: emailRaw, ip });

  const jwt = await signCuratorAccessJwt({ deal_id: deal.id, email: emailRaw, token }, 86400);

  return jr({ ok: true, jwt, expires_in: 86400 });
});
