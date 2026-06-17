// FASE 4.C.2 — Ingest de erros do frontend (RUM).
// Endpoint público (verify_jwt=false) — qualquer cliente pode reportar.
// Validação básica + tamanho máximo para evitar abuso.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractCorrelationId, withCorrelationHeader, correlatedError } from "../_shared/with-correlation.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id",
};

const MAX_STR = 4000;
const trim = (v: unknown, max = MAX_STR) =>
  typeof v === "string" ? v.slice(0, max) : null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { correlationId, body } = await extractCorrelationId(req);

  if (req.method !== "POST") {
    return correlatedError({ status: 405, error: "method_not_allowed", correlationId, cors });
  }
  if (!body || typeof body !== "object") {
    return correlatedError({ status: 400, error: "invalid_body", correlationId, cors });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const auth = req.headers.get("authorization");
  let userId: string | null = null;
  if (auth?.startsWith("Bearer ")) {
    try {
      const userRes = await sb.auth.getUser(auth.slice(7));
      userId = userRes.data.user?.id ?? null;
    } catch { /* ignore */ }
  }

  try {
    await sb.from("client_error_log").insert({
      user_id: userId,
      message: trim(body.message) ?? "(no message)",
      stack: trim(body.stack, 8000),
      source: trim(body.source, 500),
      lineno: typeof body.lineno === "number" ? body.lineno : null,
      colno: typeof body.colno === "number" ? body.colno : null,
      url: trim(body.url, 500),
      user_agent: trim(req.headers.get("user-agent") ?? body.user_agent, 500),
      correlation_id: trim(body.correlation_id, 100) ?? correlationId,
      release: trim(body.release, 100),
      metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
    });

    const res = new Response(JSON.stringify({ ok: true, correlation_id: correlationId }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
    return withCorrelationHeader(res, correlationId);
  } catch (e) {
    console.error("log-client-error", e);
    return correlatedError({ status: 500, error: "insert_failed", correlationId, cors });
  }
});
