// _deprecation.ts — Fase 1: telemetria + kill-switch para funções em aposentadoria.
//
// Uso (no topo do handler, logo após `Deno.serve(async (req) => {`):
//   const dep = await deprecationGate(req, "nome-da-funcao");
//   if (dep) return dep;
//
// Comportamento:
// - SEMPRE registra hit em `deprecation_hits` (non-blocking, fire-and-forget).
// - Se a env `DEPRECATED_PHASE1_ENABLED` estiver "true" / "1" / "on", responde 410
//   imediatamente. Caso contrário, retorna null e a função continua normal.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FLAG = (Deno.env.get("DEPRECATED_PHASE1_ENABLED") ?? "").toLowerCase();
const KILL = FLAG === "true" || FLAG === "1" || FLAG === "on" || FLAG === "yes";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

function classifySource(req: Request): string {
  if (req.headers.get("x-cron-secret")) return "cron";
  const auth = req.headers.get("authorization") ?? "";
  if (auth.includes(SERVICE_KEY)) return "internal";
  if (auth.startsWith("Bearer ")) return "ui";
  return "unknown";
}

async function logHit(req: Request, functionName: string) {
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const source = classifySource(req);
    const meta: Record<string, unknown> = {
      method: req.method,
      url: req.url,
      ua: req.headers.get("user-agent") ?? null,
      ref: req.headers.get("referer") ?? null,
      kill: KILL,
    };
    await sb.from("deprecation_hits").insert({
      function_name: functionName,
      source,
      request_meta: meta,
    });
  } catch { /* silencioso — telemetria nunca derruba a função */ }
}

export async function deprecationGate(
  req: Request,
  functionName: string,
): Promise<Response | null> {
  // OPTIONS não conta como hit
  if (req.method === "OPTIONS") return null;

  // fire-and-forget — não bloqueia resposta
  logHit(req, functionName).catch(() => {});

  if (!KILL) return null;

  return new Response(
    JSON.stringify({
      ok: false,
      error: "deprecated_phase1",
      function: functionName,
      message:
        "Esta função foi aposentada na Fase 1 (autopilot/CO Apify). Veja docs/DEPRECATION_PHASE1.md",
    }),
    {
      status: 410,
      headers: { ...CORS, "Content-Type": "application/json" },
    },
  );
}
