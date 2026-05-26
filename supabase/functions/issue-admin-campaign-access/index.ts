// Issue a campaign-access JWT for admins (bypass OTP).
// Valida o JWT do Supabase do usuário, checa role admin em user_roles,
// e devolve um JWT no mesmo formato que verify-campaign-otp.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { signAccessJwt } from "../_shared/campaign-access-jwt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jr({ error: "unauthorized" }, 401);
  }

  let token = "";
  try {
    const body = await req.json();
    token = String(body?.token ?? "").trim();
  } catch { /* ignore */ }
  if (!token || token.length < 16 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
    return jr({ error: "invalid_token" }, 400);
  }

  // Valida usuário via JWT do Supabase
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userRes, error: uErr } = await userClient.auth.getUser();
  if (uErr || !userRes?.user) return jr({ error: "unauthorized" }, 401);
  const user = userRes.user;

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Checa role admin
  const { data: roles } = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin");
  if (!roles || roles.length === 0) {
    return jr({ error: "forbidden" }, 403);
  }

  // Resolve campanha
  const { data: camp } = await svc
    .from("campaigns")
    .select("id, status")
    .eq("public_plan_token", token)
    .maybeSingle();
  if (!camp) return jr({ error: "not_found" }, 404);

  const email = (user.email ?? "admin@nexengine").toLowerCase();
  const jwt = await signAccessJwt(
    { campaign_id: camp.id, email, token },
    86400,
  );
  return jr({ ok: true, jwt, expires_in: 86400 });
});
