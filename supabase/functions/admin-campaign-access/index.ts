// Admin bypass do portal do cliente: troca a sessão do admin logado
// por um JWT do portal (mesmo formato emitido por verify-campaign-otp).
// Permite que o operador admin abra qualquer /p/plano/<token> sem PIN.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { signAccessJwt } from "../_shared/campaign-access-jwt.ts";

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

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!bearer) return jr({ error: "unauthorized" }, 401);

  let token = "";
  try {
    const body = await req.json();
    token = String(body?.token ?? "").trim();
  } catch { /* ignore */ }

  if (!token || token.length < 16 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
    return jr({ error: "invalid_token" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: userData, error: userErr } = await admin.auth.getUser(bearer);
  const user = userData?.user;
  if (userErr || !user) return jr({ error: "unauthorized" }, 401);

  const { data: isAdmin, error: roleErr } = await admin.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });
  if (roleErr || !isAdmin) return jr({ error: "forbidden" }, 403);

  const { data: camp } = await admin
    .from("campaigns")
    .select("id")
    .eq("public_plan_token", token)
    .maybeSingle();
  if (!camp) return jr({ error: "not_found" }, 404);

  const email = (user.email ?? "admin@nexengine").toLowerCase();
  const jwt = await signAccessJwt({ campaign_id: camp.id, email, token }, 86400);

  return jr({ ok: true, jwt, email, expires_in: 86400 });
});
