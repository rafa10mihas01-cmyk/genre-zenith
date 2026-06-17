// cron-recover-print-batches — Roda a cada 5min, encontra batches que ficaram
// com status='complete' mas nunca foram processados (extract falhou ou não
// disparou) e re-dispara extract-snapshot-from-print.
import { createClient } from "npm:@supabase/supabase-js@2";
import { serveCron } from "../_shared/cron-lock.ts";
import { recordMetric } from "../_shared/ops-metrics.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY")!;

serveCron({ job_name: "cron-recover-print-batches", max_retries: 2, timeout_ms: 240_000 }, async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: stuck, error } = await supabase.rpc("recover_stuck_print_batches");
  if (error) {
    console.error("rpc recover failed", error);
    await reportCronHealth(supabase, {
      job_name: "cron-recover-print-batches",
      status: "error",
      startedAt: t0,
      message: error.message,
    });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const batches = (stuck ?? []) as Array<{
    batch_id: string;
    deal_id: string;
    song_id: string | null;
    print_urls: string[];
  }>;

  let dispatched = 0;
  for (const b of batches) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/extract-snapshot-from-print`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bot-key": BOT_API_KEY,
        },
        body: JSON.stringify({
          batch_id: b.batch_id,
          deal_id: b.deal_id,
          song_id: b.song_id,
          print_urls: b.print_urls,
        }),
      });
      if (resp.ok) dispatched++;
      else console.error("redispatch failed", b.batch_id, await resp.text());
    } catch (e) {
      console.error("redispatch threw", b.batch_id, e);
    }
  }

  await supabase.from("collection_logs").insert({
    acao: "recover_print_batches",
    status: "ok",
    mensagem: `stuck=${batches.length} dispatched=${dispatched}`,
  });

  recordMetric(supabase, {
    scope: "edge_function",
    operation: "cron-recover-print-batches",
    status: "success",
    duration_ms: Date.now() - t0,
    metadata: { stuck: batches.length, dispatched },
  });

  await reportCronHealth(supabase, {
    job_name: "cron-recover-print-batches",
    status: dispatched < (stuck?.length ?? 0) ? "partial" : "ok",
    startedAt: t0,
    metrics: { stuck: batches.length, dispatched },
    message: `stuck=${batches.length} dispatched=${dispatched}`,
  });

  return new Response(
    JSON.stringify({ ok: true, stuck: batches.length, dispatched }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
});
