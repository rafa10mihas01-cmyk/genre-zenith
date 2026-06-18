// Admin bypass do portal do curador: troca a sessão do admin logado
// por um JWT do portal, sem OTP/senha para o operador interno.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { signCuratorAccessJwt } from "../_shared/curator-access-jwt.ts";

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
  if (!authHeader?.startsWith("Bearer ")) return jr({ error: "unauthorized" }, 401);

  let token = "";
  try {
    const body = await req.json();
    token = String(body?.token ?? "").trim();
  } catch { /* ignore */ }

  if (!token || token.length < 3 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
    return jr({ error: "invalid_token" }, 400);
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return jr({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userRes.user.id)
    .eq("role", "admin");
  if (!roles || roles.length === 0) return jr({ error: "forbidden" }, 403);

  const { data: deal } = await admin
    .from("curator_deals")
    .select("id, public_token, slug")
    .or(`public_token.eq.${token},slug.eq.${token}`)
    .maybeSingle();
  if (!deal) return jr({ error: "not_found" }, 404);

  const email = (userRes.user.email ?? "admin@nexengine").toLowerCase();
  const jwt = await signCuratorAccessJwt({ deal_id: deal.id, email, token }, 86400);

  return jr({ ok: true, jwt, email, expires_in: 86400 });
});