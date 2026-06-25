// _snapshot-phase6.ts — Fase 6 do Analysis Snapshot.
//
// Telemetria não-bloqueante de chamadas diretas aos motores que agora vivem
// dentro do pipeline Snapshot Único (compute-playlist-dna, diagnose-managed-playlist,
// playlist-brain-calc, calculate-playlist-ecosystem-score).
//
// Regra:
// - Se a request veio do snapshot-step-runner (header `x-snapshot-step` presente)
//   ou de um cron (`x-cron-secret`) → chamada legítima, não loga.
// - Caso contrário → grava em `deprecation_hits` com tag `bypass_snapshot`.
//
// Soft mode: NUNCA bloqueia, NUNCA derruba. Só serve pra inventariar callers
// remanescentes antes de bloquear de fato numa fase seguinte.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function logSnapshotBypass(req: Request, functionName: string): void {
  try {
    if (req.method === "OPTIONS") return;
    if (req.headers.get("x-snapshot-step")) return;   // chamada legítima do pipeline
    if (req.headers.get("x-cron-secret"))  return;    // chamada legítima de cron
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    sb.from("deprecation_hits").insert({
      function_name: functionName,
      source: "bypass_snapshot",
      request_meta: {
        method: req.method,
        url: req.url,
        ua: req.headers.get("user-agent") ?? null,
        ref: req.headers.get("referer") ?? null,
        auth_kind: req.headers.get("authorization")?.startsWith("Bearer ") ? "bearer" : "other",
      },
    }).then(() => {}, () => {}); // fire-and-forget
  } catch { /* telemetria nunca derruba a função */ }
}
