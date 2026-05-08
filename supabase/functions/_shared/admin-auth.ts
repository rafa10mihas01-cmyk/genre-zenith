// _shared/admin-auth.ts — guard restrito a admins (ou service role).
// Usado pelas edge functions do AI Ops Center.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-agent-token",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function jr(p: unknown, status: number): Response {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export type AdminAuthResult =
  | { ok: true; via: "service_role" | "admin"; userId?: string; supabase: ReturnType<typeof createClient> }
  | { ok: false; resp: Response };

export async function requireAdmin(req: Request): Promise<AdminAuthResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, resp: jr({ error: "unauthorized" }, 401) };
  }
  const token = authHeader.replace("Bearer ", "").trim();

  // Service role
  if (safeEqual(token, SERVICE_KEY)) {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    return { ok: true, via: "service_role", supabase };
  }

  // Usuário com role admin
  const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claims, error: claimsErr } = await supabaseAuth.auth.getClaims(token);
  if (claimsErr || !claims?.claims) {
    return { ok: false, resp: jr({ error: "unauthorized" }, 401) };
  }
  const userId = claims.claims.sub as string;

  // Checa role admin via user_roles
  const adminCheck = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: roles } = await adminCheck
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin");
  if (!roles || roles.length === 0) {
    return { ok: false, resp: jr({ error: "admin_required" }, 403) };
  }
  return { ok: true, via: "admin", userId, supabase: adminCheck };
}

/** Guard separado para o agente VPS (usa secret OPS_AGENT_TOKEN). */
export function requireAgentToken(req: Request): { ok: true } | { ok: false; resp: Response } {
  const expected = Deno.env.get("OPS_AGENT_TOKEN");
  if (!expected) {
    return { ok: false, resp: jr({ error: "agent_token_not_configured" }, 503) };
  }
  const provided = req.headers.get("x-agent-token") ?? "";
  if (!safeEqual(provided, expected)) {
    return { ok: false, resp: jr({ error: "invalid_agent_token" }, 401) };
  }
  return { ok: true };
}
