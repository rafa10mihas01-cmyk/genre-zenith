// FASE 4.D — Health probes para integrações externas.
// Executa probes leves contra Spotify token endpoint, Browserless, OCR, OpenAI,
// Kworb, Storage e Supabase REST. Grava em health_probes + alerta em falha.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serveCron } from "../_shared/cron-lock.ts";
import { runProbe } from "../_shared/health-probe.ts";
import { createAlert } from "../_shared/alerts.ts";
import { externalFetch } from "../_shared/external-call.ts";
import { extractCorrelationId, withCorrelationHeader } from "../_shared/with-correlation.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id",
};

type ProbeFn = () => Promise<{ latency_ms?: number; meta?: Record<string, unknown> }>;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label}_timeout`)), ms)),
  ]);
}

serveCron({ job_name: "external-health-probes-cron", max_retries: 1, timeout_ms: 240_000 }, async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { correlationId } = await extractCorrelationId(req);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  const probes: Array<[string, ProbeFn]> = [
    ["supabase_rest", async () => {
      const start = performance.now();
      const r = await externalFetch(`${SUPABASE_URL}/rest/v1/`, {
        method: "GET",
        headers: { apikey: ANON },
      }, { integration: "supabase_rest", operation: "rest_root", timeoutMs: 8000, retries: 1, correlationId });
      if (!r.ok && r.status !== 401 && r.status !== 404) throw new Error(`rest_${r.status}`);
      return { latency_ms: Math.round(performance.now() - start) };
    }],
    ["storage", async () => {
      const start = performance.now();
      const r = await externalFetch(`${SUPABASE_URL}/storage/v1/object/list/public`, {
        method: "POST",
        headers: { apikey: ANON, "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 1 }),
      }, { integration: "supabase_storage", operation: "list_root", timeoutMs: 10000, retries: 1, correlationId });
      // 400/401/403 ainda significa que o serviço responde
      if (r.status >= 500) throw new Error(`storage_${r.status}`);
      return { latency_ms: Math.round(performance.now() - start) };
    }],
    ["spotify", async () => {
      const start = performance.now();
      // probe leve: endpoint público sem auth (accounts.spotify.com retorna HTML/redirect)
      const r = await externalFetch("https://accounts.spotify.com/", {
        method: "HEAD",
      }, { integration: "spotify", operation: "accounts_head", timeoutMs: 8000, retries: 1, correlationId, bypassBreaker: true });
      if (r.status >= 500) throw new Error(`spotify_${r.status}`);
      return { latency_ms: Math.round(performance.now() - start) };
    }],
    ["openai", async () => {
      const key = Deno.env.get("LOVABLE_API_KEY") ?? Deno.env.get("OPENAI_API_KEY");
      if (!key) return { latency_ms: 0, meta: { skipped: "no_key" } };
      const start = performance.now();
      const r = await externalFetch("https://ai.gateway.lovable.dev/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
      }, { integration: "openai", operation: "list_models", timeoutMs: 10000, retries: 1, correlationId });
      if (r.status >= 500) throw new Error(`ai_${r.status}`);
      return { latency_ms: Math.round(performance.now() - start) };
    }],
    ["kworb", async () => {
      const start = performance.now();
      const r = await externalFetch("https://kworb.net/", {
        method: "HEAD",
      }, { integration: "kworb", operation: "root_head", timeoutMs: 10000, retries: 1, correlationId });
      if (r.status >= 500) throw new Error(`kworb_${r.status}`);
      return { latency_ms: Math.round(performance.now() - start) };
    }],
    ["browserless", async () => {
      const url = Deno.env.get("BROWSERLESS_URL");
      if (!url) return { latency_ms: 0, meta: { skipped: "no_url" } };
      const start = performance.now();
      const r = await externalFetch(`${url.replace(/\/$/, "")}/pressure`, {
        method: "GET",
        headers: Deno.env.get("BROWSERLESS_TOKEN")
          ? { Authorization: `Bearer ${Deno.env.get("BROWSERLESS_TOKEN")}` } : {},
      }, { integration: "browserless", operation: "pressure", timeoutMs: 8000, retries: 1, correlationId });
      if (r.status >= 500) throw new Error(`browserless_${r.status}`);
      return { latency_ms: Math.round(performance.now() - start) };
    }],
  ];

  const results: Record<string, { ok: boolean; latency_ms?: number; error?: string; meta?: unknown }> = {};

  for (const [name, fn] of probes) {
    try {
      const r = await withTimeout(runProbe(sb, name, fn, { correlation_id: correlationId } as any), 30_000, name);
      results[name] = { ok: true, latency_ms: (r as any)?.latency_ms, meta: (r as any)?.meta };
    } catch (e) {
      const err = (e as Error).message ?? String(e);
      results[name] = { ok: false, error: err };
      await createAlert(sb, {
        severity: "warning",
        subsystem: name,
        title: `External probe failed: ${name}`,
        detail: err,
        dedupe_key: `external:${name}:down`,
        cooldown_minutes: 10,
        correlation_id: correlationId,
      } as any).catch(() => {});
    }
  }

  const res = new Response(JSON.stringify({ ok: true, results, correlation_id: correlationId }, null, 2), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
  return withCorrelationHeader(res, correlationId);
});
