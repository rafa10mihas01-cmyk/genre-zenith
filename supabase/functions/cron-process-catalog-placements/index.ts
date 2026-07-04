// cron-process-catalog-placements
// Wrapper de cron (1min) que dispara o worker process-catalog-placements
// e registra cron_health. NÃO altera o worker em si — apenas o invoca via
// HTTP usando service role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withCronJob } from "../_shared/cron-lock.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH_LIMIT = 8; // low-throughput drain — cron passes limit via body

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  return withCronJob(
    admin,
    {
      job_name: "cron-process-catalog-placements",
      max_retries: 2,
      timeout_ms: 240_000,
    },
    async (_ctx) => {
      const startedAt = Date.now();
      let httpStatus = 0;
      let result: Record<string, unknown> | null = null;
      let errorMsg: string | null = null;

      try {
        const resp = await fetch(
          `${SUPABASE_URL}/functions/v1/process-catalog-placements`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_KEY}`,
            },
            body: JSON.stringify({ limit: BATCH_LIMIT }),
          },
        );
        httpStatus = resp.status;
        const txt = await resp.text();
        try { result = JSON.parse(txt); } catch { result = { raw: txt }; }
        if (!resp.ok) {
          throw new Error(
            `process-catalog-placements ${resp.status}: ${txt.slice(0, 300)}`,
          );
        }
      } catch (e) {
        errorMsg = e instanceof Error ? e.message : String(e);
        console.error("[cron-process-catalog-placements] dispatch failed:", errorMsg);
      }

      const ok = errorMsg == null;
      await reportCronHealth(admin, {
        job_name: "process-catalog-placements",
        status: ok ? "ok" : "error",
        startedAt,
        metrics: { http_status: httpStatus, ...(result ?? {}) },
        message: errorMsg ?? undefined,
      });

      if (!ok) throw new Error(errorMsg!);
      return { http_status: httpStatus, ...(result ?? {}) };
    },
  );
});
