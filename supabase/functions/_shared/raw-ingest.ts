// Helper compartilhado: grava o payload HTTP bruto recebido dos bots/VPS
// na tabela `bot_ingest_raw` ANTES de qualquer transformação.
//
// Uso (dentro do handler de uma edge function):
//
//   const rawText = await req.text();
//   const bodyJson = safeJsonParse(rawText);
//   const rawId = await logRawIngest(supabase, {
//     endpoint: "bot-ingest-song-snapshot",
//     req,
//     rawText,
//     payload: bodyJson,
//   });
//   // ... processa bodyJson normalmente ...
//   await markRawIngestProcessed(supabase, rawId, { status: "ok", output_ids: { snapshot_id } });
//
// Falhas no log NÃO devem derrubar o ingest — sempre try/catch.

// deno-lint-ignore-file no-explicit-any

export type RawIngestInput = {
  endpoint: string;
  req: Request;
  rawText: string;
  payload: any;
};

export function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function pickHeaders(req: Request): Record<string, string> {
  // Subset seguro — NUNCA inclui authorization/apikey/cookie
  const allow = new Set([
    "content-type",
    "content-length",
    "user-agent",
    "x-correlation-id",
    "x-request-id",
    "x-worker-id",
    "x-source",
    "x-forwarded-for",
    "cf-connecting-ip",
  ]);
  const out: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (allow.has(k.toLowerCase())) out[k.toLowerCase()] = v;
  });
  return out;
}

function pickField(obj: any, keys: string[]): any {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    if (obj[k] != null) return obj[k];
  }
  return null;
}

function extractRefs(payload: any) {
  const root = payload ?? {};
  const meta = root.bot_metadata ?? root.metadata ?? {};
  const isUuid = (v: any) =>
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  const pick = (keys: string[]) => {
    const v = pickField(root, keys) ?? pickField(meta, keys);
    return isUuid(v) ? v : null;
  };

  return {
    campaign_id: pick(["campaign_id", "campaignId"]),
    deal_id: pick(["deal_id", "dealId"]),
    song_id: pick(["song_id", "songId"]),
    snapshot_id: pick(["snapshot_id", "snapshotId"]),
    correlation_id:
      pickField(root, ["correlation_id", "correlationId"]) ??
      pickField(meta, ["correlation_id", "correlationId"]) ??
      null,
    worker_id:
      pickField(root, ["worker_id", "workerId"]) ??
      pickField(meta, ["worker_id", "workerId"]) ??
      null,
    source:
      pickField(root, ["source"]) ??
      pickField(meta, ["source"]) ??
      pickField(meta, ["worker_id", "workerId"]) ??
      "unknown",
  };
}

export async function logRawIngest(
  supabase: any,
  { endpoint, req, rawText, payload }: RawIngestInput,
): Promise<string | null> {
  try {
    const refs = extractRefs(payload);
    const headers = pickHeaders(req);
    const correlation_id =
      refs.correlation_id ??
      headers["x-correlation-id"] ??
      headers["x-request-id"] ??
      null;
    const worker_id = refs.worker_id ?? headers["x-worker-id"] ?? null;
    const source = refs.source ?? headers["x-source"] ?? "unknown";
    const ip =
      headers["cf-connecting-ip"] ??
      (headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? null);

    const payload_size_bytes = new TextEncoder().encode(rawText ?? "").byteLength;
    const payload_hash = rawText ? await sha256Hex(rawText) : null;

    const { data, error } = await supabase
      .from("bot_ingest_raw")
      .insert({
        source: String(source).slice(0, 200),
        endpoint,
        correlation_id: correlation_id ? String(correlation_id).slice(0, 200) : null,
        worker_id: worker_id ? String(worker_id).slice(0, 200) : null,
        campaign_id: refs.campaign_id,
        deal_id: refs.deal_id,
        song_id: refs.song_id,
        snapshot_id: refs.snapshot_id,
        payload_json: payload ?? { _raw_text: rawText },
        payload_size_bytes,
        payload_hash,
        headers_json: headers,
        http_method: req.method,
        ip,
        processed: false,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.warn("[raw-ingest] insert failed:", error.message);
      return null;
    }
    return (data as any)?.id ?? null;
  } catch (err) {
    console.warn("[raw-ingest] exception:", (err as Error)?.message);
    return null;
  }
}

export async function markRawIngestProcessed(
  supabase: any,
  rawId: string | null,
  result: Record<string, any>,
): Promise<void> {
  if (!rawId) return;
  try {
    await supabase
      .from("bot_ingest_raw")
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
        processing_result: result,
      })
      .eq("id", rawId);
  } catch (err) {
    console.warn("[raw-ingest] mark processed failed:", (err as Error)?.message);
  }
}
