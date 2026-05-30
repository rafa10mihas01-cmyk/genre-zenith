// bot-ingest-dom — Recebe dados DOM (playsMap) do bot diretamente, sem prints.
// Auth: header x-bot-key.
//
// Aceita 2 formatos:
// 1) Single: { deal_id, song_id, playlists: [...], note? }
// 2) Batch:  { items: [{ deal_id, song_id, playlists, note? }, ...] }
import { createClient } from "npm:@supabase/supabase-js@2";
import { recordMetric } from "../_shared/ops-metrics.ts";
import { processDomItem, type DomItem } from "../_shared/ingest-dom.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-bot-key, x-bot-token, x-worker-id, x-process-id, x-hostname, x-timer-id, x-bot-name, x-bot-session, x-correlation-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY") ?? "";
const BOT_INGEST_TOKEN = Deno.env.get("BOT_INGEST_TOKEN") ?? "";

function isAuthorizedBot(req: Request): boolean {
  const candidates = [
    req.headers.get("x-bot-key"),
    req.headers.get("x-bot-token"),
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""),
  ].map((v) => (v ?? "").trim()).filter(Boolean);
  const allowed = [BOT_API_KEY, BOT_INGEST_TOKEN].filter(Boolean);
  return candidates.some((c) => allowed.includes(c));
}

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);
  if (req.headers.get("x-bot-key") !== BOT_API_KEY) return jr({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return jr({ error: "invalid_json" }, 400); }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const correlationHeader = req.headers.get("x-correlation-id");

  const items: DomItem[] = Array.isArray(body?.items)
    ? body.items.map((i: any) => ({ ...i, correlation_id: i.correlation_id ?? correlationHeader ?? null }))
    : [{ ...body, correlation_id: body?.correlation_id ?? correlationHeader ?? null }];

  const results: Awaited<ReturnType<typeof processDomItem>>[] = [];
  let totalInserted = 0;
  let totalSkipped = 0;
  let errors = 0;

  for (const item of items) {
    try {
      const r = await processDomItem(supabase, item);
      results.push(r);
      totalInserted += r.inserted ?? 0;
      totalSkipped += r.skipped ?? 0;
      if (!r.ok) errors++;
    } catch (e) {
      errors++;
      results.push({ song_id: (item as any)?.song_id ?? "", ok: false, error: (e as Error).message });
    }
  }

  await supabase.from("collection_logs").insert({
    acao: "bot_ingest_dom",
    status: errors > 0 ? "parcial" : "ok",
    mensagem: `items=${items.length} inserted=${totalInserted} skipped=${totalSkipped} errors=${errors}`,
  });

  recordMetric(supabase, {
    scope: "bot",
    operation: "bot-ingest-dom",
    status: errors > 0 ? "partial" : "success",
    duration_ms: Date.now() - t0,
    metadata: { items: items.length, inserted: totalInserted, skipped: totalSkipped, errors },
  });

  return jr({ ok: errors === 0, results, inserted: totalInserted, skipped: totalSkipped });
});
