// _shared/auth.ts — guard reutilizável para edge functions sensíveis.
//
// Aceita 2 caminhos:
//   1. service_role (chamadas internas do autopilot/cron) → libera direto
//   2. usuário autenticado COM role admin/curador (has_team_access) → libera
// Bloqueia: anônimos, usuários sem role, tokens inválidos.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jr(p: unknown, status: number): Response {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export type AuthGuardResult =
  | { ok: true; via: "service_role" | "user"; userId?: string }
  | { ok: false; resp: Response };

// Comparação constant-time para evitar timing attacks na validação do SERVICE_KEY.
// Bytes diferentes ou tamanhos diferentes → false (sem early return baseado em conteúdo).
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) {
    // Compara mesmo assim com tamanho fixo pra reduzir leak de length
    let diff = ab.length ^ bb.length;
    for (let i = 0; i < Math.min(ab.length, bb.length); i++) diff |= ab[i] ^ bb[i];
    return diff === 0;
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

async function hasValidCronSecret(req: Request): Promise<boolean> {
  const cronSecret = req.headers.get("x-cron-secret")?.trim();
  if (!cronSecret) return false;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("get_cron_secret");
  return !error && typeof data === "string" && safeEqual(cronSecret, data);
}

/**
 * Garante que a chamada vem do service role OU de um usuário admin/curador.
 * Use no início de qualquer edge function que dispara IA cara, publica no Spotify
 * ou modifica dados sensíveis.
 */
export async function requireTeamAccess(req: Request): Promise<AuthGuardResult> {
  if (await hasValidCronSecret(req)) {
    return { ok: true, via: "service_role" };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, resp: jr({ error: "unauthorized" }, 401) };
  }
  const token = authHeader.replace("Bearer ", "").trim();

  // Caminho 1: service role (chamadas internas) — comparação constant-time
  if (safeEqual(token, SERVICE_KEY)) {
    return { ok: true, via: "service_role" };
  }

  // Caminho 2: usuário autenticado com role
  const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claims, error: claimsErr } = await supabaseAuth.auth.getClaims(token);
  if (claimsErr || !claims?.claims) {
    return { ok: false, resp: jr({ error: "unauthorized" }, 401) };
  }
  const { data: hasAccess, error: rpcErr } = await supabaseAuth.rpc("has_team_access");
  if (rpcErr || !hasAccess) {
    return { ok: false, resp: jr({ error: "forbidden" }, 403) };
  }
  return { ok: true, via: "user", userId: claims.claims.sub as string | undefined };
}
