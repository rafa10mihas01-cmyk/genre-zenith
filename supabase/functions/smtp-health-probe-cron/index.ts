// FASE 4.C.3 — SMTP health probe.
// Executa um envio silencioso periódico (DRY-RUN se SMTP_HEALTH_TO ausente)
// pra medir latência/sucesso e gravar em health_probes + system_alerts em falha.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serveCron } from "../_shared/cron-lock.ts";
import { runProbe } from "../_shared/health-probe.ts";
import { createAlert } from "../_shared/alerts.ts";
import { extractCorrelationId, withCorrelationHeader } from "../_shared/with-correlation.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id",
};

const SMTP_HOST = Deno.env.get("SMTP_HOST");
const SMTP_PORT = parseInt(Deno.env.get("SMTP_PORT") ?? "587", 10);
const SMTP_USER = Deno.env.get("SMTP_USER");
const SMTP_PASS = Deno.env.get("SMTP_PASS");
const SMTP_HEALTH_TO = Deno.env.get("SMTP_HEALTH_TO"); // opcional; se ausente, só testa conexão TCP

async function probeSmtp(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = performance.now();
  try {
    if (!SMTP_HOST) {
      return { ok: false, latencyMs: 0, error: "SMTP_HOST not configured" };
    }
    // Apenas TCP handshake — barato e suficiente como health probe.
    const conn = await Promise.race([
      Deno.connect({ hostname: SMTP_HOST, port: SMTP_PORT }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("smtp_tcp_timeout")), 8000)),
    ]);
    try {
      const buf = new Uint8Array(64);
      await Promise.race([
        (conn as Deno.Conn).read(buf),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("smtp_banner_timeout")), 5000)),
      ]);
    } finally {
      try { (conn as Deno.Conn).close(); } catch { /* ignore */ }
    }
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: (e as Error).message ?? String(e),
    };
  }
}

serveCron({ job_name: "smtp-health-probe-cron", max_retries: 0, timeout_ms: 240_000 }, async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { correlationId } = await extractCorrelationId(req);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const result = await runProbe(sb, "smtp", async () => {
    const r = await probeSmtp();
    if (!r.ok) throw new Error(r.error ?? "smtp_probe_failed");
    return { latency_ms: r.latencyMs };
  }, { correlation_id: correlationId }).catch((e) => ({ ok: false, error: (e as Error).message }));

  if (!(result as any).ok) {
    await createAlert(sb, {
      severity: "critical",
      subsystem: "smtp",
      title: "SMTP probe failed",
      detail: (result as any).error ?? "unknown",
      dedupe_key: "smtp:probe:down",
      cooldown_minutes: 10,
      correlation_id: correlationId,
    }).catch(() => {});
  }

  const res = new Response(JSON.stringify({ ok: true, result, correlation_id: correlationId }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
  return withCorrelationHeader(res, correlationId);
});
