// recover-stuck-print-batches
// One-shot ops tool: reconstrói batches presos em status=processing usando os
// PNGs reais que estão no bucket bot-prints, marca complete e chama
// extract-snapshot-from-print.
//
// POST { batch_id?: string, all?: boolean, dry_run?: boolean }
// Auth: header x-bot-key (BOT_API_KEY).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY")!;
const BUCKET = "bot-prints";
const SIGNED_URL_TTL = 60 * 60 * 24 * 365;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-bot-key, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Batch {
  id: string;
  deal_id: string;
  song_id: string | null;
  batch_key: string;
  total_parts: number;
  received_parts: number;
  correlation_id: string | null;
  dom_payload: any;
  status: string;
}

interface RecoveryResult {
  batch_id: string;
  deal_id: string;
  song_id: string | null;
  total_parts: number;
  previous_received: number;
  storage_files_found: number;
  rebuilt_paths: number;
  signed_urls: number;
  marked_complete: boolean;
  extract_triggered: boolean;
  extract_response?: unknown;
  error?: string;
}

async function recoverOne(supabase: any, b: Batch, dryRun: boolean): Promise<RecoveryResult> {
  const res: RecoveryResult = {
    batch_id: b.id,
    deal_id: b.deal_id,
    song_id: b.song_id,
    total_parts: b.total_parts,
    previous_received: b.received_parts,
    storage_files_found: 0,
    rebuilt_paths: 0,
    signed_urls: 0,
    marked_complete: false,
    extract_triggered: false,
  };

  // 1. Listar PNGs reais do storage pela pasta do deal/song.
  const prefix = b.song_id ? `${b.deal_id}/${b.song_id}` : `${b.deal_id}`;
  const { data: files, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (listErr) { res.error = `list_failed: ${listErr.message}`; return res; }

  // Filtra pelo batch_key. Path completo é `${prefix}/${file.name}`.
  const matching = (files ?? [])
    .filter((f: any) => f.name.includes(b.batch_key) && f.name.endsWith(".png"))
    .map((f: any) => `${prefix}/${f.name}`)
    .sort();
  res.storage_files_found = matching.length;

  if (matching.length === 0) {
    res.error = "no_storage_files_for_batch_key";
    return res;
  }

  // 2. Deduplicar por part-N-of-M, mantendo o mais recente em caso de retry.
  const byPart = new Map<string, string>();
  for (const p of matching) {
    const m = p.match(/-part-(\d+)-of-(\d+)\.png$/i);
    if (!m) continue;
    const key = `${m[1]}-${m[2]}`;
    byPart.set(key, p); // sorted asc → última escrita vence
  }
  const finalPaths = Array.from(byPart.values()).sort();
  res.rebuilt_paths = finalPaths.length;

  if (finalPaths.length !== b.total_parts) {
    res.error = `partial_storage: have ${finalPaths.length}, expected ${b.total_parts}`;
    // Continua mesmo assim se houver pelo menos N-1? Não — só finaliza com total.
    if (finalPaths.length < b.total_parts) return res;
  }

  // 3. Gera signed URLs.
  const urls: string[] = [];
  for (const p of finalPaths) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(p, SIGNED_URL_TTL);
    if (error || !data?.signedUrl) { res.error = `sign_failed: ${p}: ${error?.message}`; return res; }
    urls.push(data.signedUrl);
  }
  res.signed_urls = urls.length;

  if (dryRun) return res;

  // 4. Atualiza o batch de forma idempotente.
  const { error: updErr } = await supabase
    .from("bot_print_batches")
    .update({
      print_paths: finalPaths,
      print_urls: urls,
      received_parts: finalPaths.length,
      status: finalPaths.length >= b.total_parts ? "complete" : "pending",
      completed_at: finalPaths.length >= b.total_parts ? new Date().toISOString() : null,
    })
    .eq("id", b.id);
  if (updErr) { res.error = `batch_update_failed: ${updErr.message}`; return res; }
  res.marked_complete = finalPaths.length >= b.total_parts;

  // 5. Dispara extract.
  if (res.marked_complete) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/extract-snapshot-from-print`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bot-key": BOT_API_KEY },
        body: JSON.stringify({
          batch_id: b.id,
          deal_id: b.deal_id,
          song_id: b.song_id,
          print_urls: urls,
          dom_playlists: Array.isArray(b.dom_payload) ? b.dom_payload : [],
          correlation_id: b.correlation_id,
        }),
      });
      const txt = await r.text();
      let body: unknown = txt; try { body = JSON.parse(txt); } catch (_) {}
      res.extract_triggered = true;
      res.extract_response = { status: r.status, body };
    } catch (e) {
      res.error = `extract_dispatch_failed: ${String(e)}`;
    }
  }

  return res;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);

  const key = (req.headers.get("x-bot-key") ?? "").trim();
  if (!key || key !== (BOT_API_KEY ?? "").trim()) return jr({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const batchId = typeof body.batch_id === "string" ? body.batch_id : null;
  const all = body.all === true;
  const dryRun = body.dry_run === true;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let batches: Batch[] = [];
  if (batchId) {
    const { data, error } = await supabase
      .from("bot_print_batches")
      .select("id, deal_id, song_id, batch_key, total_parts, received_parts, correlation_id, dom_payload, status")
      .eq("id", batchId)
      .maybeSingle();
    if (error) return jr({ error: error.message }, 500);
    if (!data) return jr({ error: "batch_not_found" }, 404);
    batches = [data as Batch];
  } else if (all) {
    const { data, error } = await supabase
      .from("bot_print_batches")
      .select("id, deal_id, song_id, batch_key, total_parts, received_parts, correlation_id, dom_payload, status")
      .eq("status", "processing")
      .order("created_at", { ascending: true });
    if (error) return jr({ error: error.message }, 500);
    batches = (data ?? []) as Batch[];
  } else {
    return jr({ error: "provide batch_id or all=true" }, 400);
  }

  const results: RecoveryResult[] = [];
  for (const b of batches) {
    // Pula batches que não estão presos.
    if (b.status === "complete" || b.status === "processed") {
      results.push({
        batch_id: b.id, deal_id: b.deal_id, song_id: b.song_id,
        total_parts: b.total_parts, previous_received: b.received_parts,
        storage_files_found: 0, rebuilt_paths: 0, signed_urls: 0,
        marked_complete: true, extract_triggered: false,
        error: "skipped_not_processing",
      });
      continue;
    }
    const r = await recoverOne(supabase, b, dryRun);
    results.push(r);
    // Pequena pausa pra não saturar createSignedUrl/extract concorrente.
    await new Promise((res) => setTimeout(res, 250));
  }

  const summary = {
    total: results.length,
    recovered: results.filter((r) => r.marked_complete && !r.error).length,
    extract_ok: results.filter((r) => r.extract_triggered && !r.error).length,
    errors: results.filter((r) => r.error).length,
    dry_run: dryRun,
  };
  return jr({ summary, results });
});
