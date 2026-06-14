// bot-upload-print — Recebe PNG do bot e armazena no bucket bot-prints (privado).
// Auth: header x-bot-key.
// POST multipart/form-data: file (PNG), deal_id, song_id, label?
// OU POST application/octet-stream com query ?deal_id=&song_id=&label=
//
// LABEL ESPECIAL: "playlists-part-X-of-Y" (ex: "playlists-part-1-of-3")
// → agrupa em bot_print_batches. Quando todas as Y partes chegarem,
//   dispara extract-snapshot-from-print automaticamente.
//
// Retorna { ok, path, signed_url, expires_in, batch? }
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertDealOperable } from "../_shared/deal-access.ts";
import { recordMetric } from "../_shared/ops-metrics.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-bot-key, x-bot-token, x-correlation-id, x-dom-playlists, x-worker-id, x-process-id, x-hostname, x-timer-id, x-bot-name, x-bot-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY")!;
const BOT_INGEST_TOKEN = Deno.env.get("BOT_INGEST_TOKEN") ?? "";
const BUCKET = "bot-prints";
const SIGNED_URL_TTL = 60 * 60 * 24 * 365; // 1 ano
const MAX_DOM_PLAYLISTS_FOR_SINGLE_PRINT = 30;

function isAuthorizedBotKey(value: string | null) {
  const normalize = (v: string | null | undefined) => (v ?? "").trim().replace(/^Bearer\s+/i, "").replace(/^[\'"]|[\'"]$/g, "");
  const got = normalize(value);
  return Boolean(got) && (got === normalize(BOT_API_KEY) || got === normalize(BOT_INGEST_TOKEN));
}

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeSeg(s: string | null | undefined, fallback = "unknown") {
  const v = (s ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return v || fallback;
}

// "playlists-part-2-of-3" → { key: "playlists", part: 2, total: 3 }
function parsePartLabel(label: string): { key: string; part: number; total: number } | null {
  const m = label.match(/^(.+)-part-(\d+)-of-(\d+)$/i);
  if (!m) return null;
  const part = parseInt(m[2], 10);
  const total = parseInt(m[3], 10);
  if (!isFinite(part) || !isFinite(total) || part < 1 || total < 1 || part > total) return null;
  return { key: m[1], part, total };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);
  const authKey = req.headers.get("x-bot-key") ?? req.headers.get("x-bot-token") ?? req.headers.get("authorization");
  if (!isAuthorizedBotKey(authKey)) {
    return jr({ error: "unauthorized" }, 401);
  }
  const t0 = Date.now();

  const url = new URL(req.url);
  const ct = req.headers.get("content-type") ?? "";
  let bytes: Uint8Array | null = null;
  let dealId = url.searchParams.get("deal_id") ?? "";
  let songId = url.searchParams.get("song_id") ?? "";
  let label = url.searchParams.get("label") ?? "";
  // Modo catálogo: coleta de catalog_tracks NÃO tem deal_id. Aceitamos
  // catalog_track_id como alternativa pra salvar o print scopado por catálogo.
  let catalogTrackId = url.searchParams.get("catalog_track_id") ?? "";
  let correlationId =
    req.headers.get("x-correlation-id") ?? url.searchParams.get("correlation_id") ?? "";

  // dom_playlists: [{ name, url, plays_text? }] — extraído via page.evaluate
  // pelo Claudio antes do print. Permite match determinístico por spotify_playlist_id.
  let domPlaylists: Array<{ name?: string; url?: string; plays_text?: string }> = [];

  try {
    if (ct.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const f = form.get("file");
      if (!(f instanceof File)) return jr({ error: "file required" }, 400);
      bytes = new Uint8Array(await f.arrayBuffer());
      dealId = (form.get("deal_id") as string) || dealId;
      songId = (form.get("song_id") as string) || songId;
      label = (form.get("label") as string) || label;
      catalogTrackId = (form.get("catalog_track_id") as string) || catalogTrackId;
      correlationId = (form.get("correlation_id") as string) || correlationId;
      const domRaw = form.get("dom_playlists");
      if (typeof domRaw === "string" && domRaw.trim()) {
        try {
          const parsed = JSON.parse(domRaw);
          if (Array.isArray(parsed)) domPlaylists = parsed;
        } catch (_) { /* ignore */ }
      }
    } else if (ct.includes("application/json")) {
      // Bridge VPS manda { content_base64, deal_id, song_id, label, correlation_id, dom_playlists }
      const body = await req.json();
      const b64Raw: string = body?.content_base64 ?? body?.file_base64 ?? body?.image_base64 ?? "";
      if (typeof b64Raw !== "string" || !b64Raw) {
        return jr({ error: "content_base64 required" }, 400);
      }
      // Aceita data URL ("data:image/png;base64,...") ou base64 puro
      const b64 = b64Raw.includes(",") ? b64Raw.split(",", 2)[1] : b64Raw;
      try {
        const bin = atob(b64.replace(/\s+/g, ""));
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        bytes = arr;
      } catch (e) {
        return jr({ error: "invalid_base64", detail: String(e) }, 400);
      }
      dealId = body?.deal_id || dealId;
      songId = body?.song_id || songId;
      label = body?.label || label;
      catalogTrackId = body?.catalog_track_id || catalogTrackId;
      correlationId = body?.correlation_id || correlationId;
      if (Array.isArray(body?.dom_playlists)) domPlaylists = body.dom_playlists;
    } else {
      const buf = await req.arrayBuffer();
      bytes = new Uint8Array(buf);
      const domHeader = req.headers.get("x-dom-playlists");
      if (domHeader) {
        try {
          const parsed = JSON.parse(domHeader);
          if (Array.isArray(parsed)) domPlaylists = parsed;
        } catch (_) { /* ignore */ }
      }
    }
  } catch (e) {
    return jr({ error: "invalid_body", detail: String(e) }, 400);
  }

  // Sanity check: PNG começa com magic bytes 89 50 4E 47. Se vier outra coisa
  // (ex: JSON tratado como bytes), rejeita pra não poluir storage com lixo.
  if (bytes && bytes.length >= 4) {
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    const isJpg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
    if (!isPng && !isJpg) {
      return jr({
        error: "invalid_image_bytes",
        detail: "Body não começa com magic bytes de PNG/JPEG. Verifique se o bridge mandou bytes corretos ou base64 válido.",
        first_bytes_hex: Array.from(bytes.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join(" "),
      }, 415);
    }
  }

  if (!bytes || bytes.length === 0) return jr({ error: "empty_file" }, 400);
  if (bytes.length > 8 * 1024 * 1024) return jr({ error: "file_too_large_8mb" }, 413);
  if (!dealId && !catalogTrackId) {
    return jr({
      error: "deal_id_or_catalog_track_id_required",
      detail: "Print sem deal_id nem catalog_track_id vira órfão e não aparece em nenhuma coleta.",
    }, 400);
  }

  // Catalog mode = não tem deal, é coleta do catálogo. Pula gates/batches de deal.
  const isCatalogMode = !dealId && !!catalogTrackId;

  const parsed = parsePartLabel(label);

  // 🚫 Bloqueio do fluxo LEGADO "playlists-part-*".
  // O VPS ainda dispara dois batches por coleta (playlists + song-snapshot-*) com o mesmo
  // correlation_id, duplicando o histórico. Apenas o "song-snapshot-{correlation_id}-part-*"
  // é o fluxo válido. Rejeitamos o legado aqui pra parar a duplicação enquanto o bot não
  // for atualizado. Quando o dist do bot remover o envio duplicado, este guard pode sair.
  if (parsed?.key === "playlists") {
    return jr({
      error: "legacy_playlists_label_deprecated",
      detail: "Label 'playlists-part-*' foi descontinuado. Use 'song-snapshot-{correlation_id}-part-X-of-Y'. Este upload foi descartado pra evitar duplicar o histórico.",
      received_label: label,
      correlation_id: correlationId,
    }, 410);
  }

  if (parsed?.key === "playlists" && parsed.total === 1 && domPlaylists.length > MAX_DOM_PLAYLISTS_FOR_SINGLE_PRINT) {
    return jr({
      error: "clipped_playlist_batch_rejected",
      detail: `DOM trouxe ${domPlaylists.length} playlists, mas o bot declarou só 1 print. Gere múltiplas partes antes de enviar.`,
      received_dom_playlists: domPlaylists.length,
      expected_label: "playlists-part-1-of-N",
    }, 422);
  }

  const dSeg = safeSeg(dealId, "no-deal");
  const sSeg = safeSeg(songId, "no-song");
  const lSeg = safeSeg(label, "print");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${dSeg}/${sSeg}/${ts}-${lSeg}.png`;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 🔍 Auditoria: grava metadados do upload (não armazenamos os bytes da imagem,
  // só refs + headers + tamanho — a imagem já vai pro storage `bot-prints`).
  try {
    const { logRawIngest } = await import("../_shared/raw-ingest.ts");
    await logRawIngest(supabase, {
      endpoint: "bot-upload-print",
      req,
      rawText: "",
      payload: {
        deal_id: dealId || null,
        song_id: songId || null,
        label: label || null,
        correlation_id: correlationId || null,
        content_type: ct,
        bytes_size: bytes?.length ?? 0,
        dom_playlists_count: domPlaylists.length,
        target_path: path,
      },
    });
  } catch (_) { /* never block ingest */ }

  // ====== Gate de ciclo de vida (Fase 5B) ======
  if (dealId) {
    const { data: dealRow } = await supabase
      .from("curator_deals")
      .select("id, state, closed_at, token_revoked_at, token_expires_at")
      .eq("id", dealId)
      .maybeSingle();
    const gate = assertDealOperable(dealRow as any);
    if (!gate.ok) {
      return jr({ error: gate.error, code: gate.code, gated: true }, gate.status);
    }
  }

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "image/png", upsert: false });
  if (upErr) return jr({ error: "upload_failed", detail: upErr.message }, 500);

  // Retry createSignedUrl com backoff exponencial. NÃO faz fallback pra URL pública
  // porque o bucket é privado — URL pública retorna 403 e quebra o Gemini.
  let signedUrl: string | null = null;
  let lastSignErr: string | null = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL);
    if (!error && data?.signedUrl) {
      signedUrl = data.signedUrl;
      break;
    }
    lastSignErr = error?.message ?? "unknown";
    console.warn(`createSignedUrl attempt ${attempt} failed:`, lastSignErr);
    if (attempt < 6) {
      await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt - 1)));
    }
  }
  if (!signedUrl) {
    console.error("sign_failed_aborting", { path, lastSignErr });
    return jr({ error: "sign_url_failed", detail: lastSignErr, path }, 500);
  }
  const signedUrlKind = "signed" as const;
  const signed = { signedUrl };

  // ========== AGRUPAMENTO MULTI-PART (idempotente por correlation_id) ==========
  let batchInfo: Record<string, unknown> | undefined;

  if (parsed && dealId) {
    // Cada correlation_id representa UMA execução do worker. Constraint UNIQUE
    // no banco garante 1 batch por correlation_id; aqui dedupamos antes.
    let existing: any = null;
    if (correlationId) {
      const { data } = await supabase
        .from("bot_print_batches")
        .select("id, received_parts, total_parts, print_paths, print_urls, status, dom_payload")
        .eq("correlation_id", correlationId)
        .maybeSingle();
      existing = data ?? null;
    } else {
      let q = supabase
        .from("bot_print_batches")
        .select("id, received_parts, total_parts, print_paths, print_urls, status, dom_payload")
        .eq("deal_id", dealId)
        .eq("batch_key", parsed.key)
        .eq("status", "pending");
      q = songId ? q.eq("song_id", songId) : q.is("song_id", null);
      const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
      existing = data ?? null;
    }

    // Replay de batch já terminal → idempotente, não duplica.
    if (existing && (existing.status === "complete" || existing.status === "processed" || existing.status === "error")) {
      void supabase.from("collection_logs").insert({
        acao: "bot_print_duplicate_dropped",
        status: "warning",
        mensagem: `correlation_id=${correlationId} já tinha batch ${existing.id} (${existing.status}). Upload aceito mas batch NÃO duplicado.`,
      });
      return jr({
        ok: true,
        path,
        signed_url: signed.signedUrl,
        signed_url_kind: signedUrlKind,
        expires_in: SIGNED_URL_TTL,
        batch: {
          batch_id: existing.id,
          received_parts: existing.received_parts,
          total_parts: existing.total_parts,
          complete: true,
          dom_count: Array.isArray(existing.dom_payload) ? existing.dom_payload.length : 0,
          correlation_id: correlationId || null,
          idempotent_replay: true,
        },
      });
    }

    let batchId: string;
    let receivedParts: number;
    let printPaths: string[];
    let printUrls: string[];
    let mergedDom: any[] = [];

    if (!existing) {
      const { data: created, error: bErr } = await supabase
        .from("bot_print_batches")
        .insert({
          deal_id: dealId,
          song_id: songId || null,
          batch_key: parsed.key,
          total_parts: parsed.total,
          received_parts: 1,
          print_paths: [path],
          print_urls: [signed.signedUrl],
          dom_payload: domPlaylists,
          status: parsed.total === 1 ? "complete" : "pending",
          correlation_id: correlationId || null,
        })
        .select("id")
        .single();
      if (bErr) {
        // Race: outra request inseriu o mesmo correlation_id em paralelo.
        if ((bErr as any).code === "23505" && correlationId) {
          const { data: raceRow } = await supabase
            .from("bot_print_batches")
            .select("id, received_parts, total_parts, status, dom_payload")
            .eq("correlation_id", correlationId)
            .maybeSingle();
          if (raceRow) {
            return jr({
              ok: true,
              path,
              signed_url: signed.signedUrl,
              signed_url_kind: signedUrlKind,
              expires_in: SIGNED_URL_TTL,
              batch: {
                batch_id: raceRow.id,
                received_parts: raceRow.received_parts,
                total_parts: raceRow.total_parts,
                complete: raceRow.status === "complete" || raceRow.status === "processed",
                dom_count: Array.isArray(raceRow.dom_payload) ? raceRow.dom_payload.length : 0,
                correlation_id: correlationId,
                idempotent_replay: true,
              },
            });
          }
        }
        console.error("batch insert err", bErr);
      }
      batchId = created?.id ?? "";
      receivedParts = 1;
      printPaths = [path];
      printUrls = [signed.signedUrl];
      mergedDom = domPlaylists;
    } else {
      batchId = existing.id;
      printPaths = [...(existing.print_paths as string[] ?? []), path];
      printUrls = [...(existing.print_urls as string[] ?? []), signed.signedUrl];
      receivedParts = (existing.received_parts ?? 0) + 1;
      const prevDom = (existing.dom_payload as any[]) ?? [];
      const seenUrls = new Set(prevDom.map((d) => d?.url).filter(Boolean));
      const newOnes = domPlaylists.filter((d) => d?.url && !seenUrls.has(d.url));
      mergedDom = [...prevDom, ...newOnes];

      if (newOnes.length === 0 && parsed.part > 1) {
        void supabase.from("collection_logs").insert({
          acao: "bot_print_overshoot",
          status: "warning",
          mensagem: `batch=${existing.id} part=${parsed.part}/${parsed.total} brought 0 new rows (total_unique=${prevDom.length}). Worker está enviando prints redundantes.`,
        });
      }
      const isComplete = receivedParts >= (existing.total_parts ?? parsed.total);
      const updatePatch: Record<string, unknown> = {
        received_parts: receivedParts,
        print_paths: printPaths,
        print_urls: printUrls,
        dom_payload: mergedDom,
        status: isComplete ? "complete" : "pending",
        completed_at: isComplete ? new Date().toISOString() : null,
      };
      if (correlationId) updatePatch.correlation_id = correlationId;
      await supabase
        .from("bot_print_batches")
        .update(updatePatch)
        .eq("id", batchId);
    }

    batchInfo = {
      batch_id: batchId,
      received_parts: receivedParts,
      total_parts: parsed.total,
      complete: receivedParts >= parsed.total,
      dom_count: mergedDom.length,
      correlation_id: correlationId || null,
    };

    // Lifecycle event: PRINT_UPLOADED (parcial ou final)
    if (correlationId) {
      void supabase.from("bot_events").insert({
        bot_name: req.headers.get("x-bot-name") ?? "spotify-artists-bot",
        session_id: req.headers.get("x-bot-session"),
        deal_id: dealId,
        song_id: songId || null,
        step: "upload_print",
        status: "running",
        lifecycle_state: "PRINT_UPLOADED",
        correlation_id: correlationId,
        worker_id: req.headers.get("x-worker-id"),
        process_id: req.headers.get("x-process-id"),
        hostname: req.headers.get("x-hostname"),
        timer_id: req.headers.get("x-timer-id"),
        message: `Part ${parsed.part}/${parsed.total} received`,
        url: signed.signedUrl,
        metadata: { batch_id: batchId, received_parts: receivedParts, total_parts: parsed.total },
      });
    }

    // Se completou, dispara extract assíncrono (fire-and-forget)
    if (receivedParts >= parsed.total && batchId) {
      const extractUrl = `${SUPABASE_URL}/functions/v1/extract-snapshot-from-print`;
      fetch(extractUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bot-key": BOT_API_KEY,
        },
        body: JSON.stringify({
          batch_id: batchId,
          deal_id: dealId,
          song_id: songId || null,
          print_urls: printUrls,
          dom_playlists: mergedDom,
          correlation_id: correlationId || null,
        }),
      }).catch((e) => console.error("extract dispatch failed", e));
    }
  }

  recordMetric(supabase, {
    scope: "bot",
    operation: "bot-upload-print",
    status: "success",
    duration_ms: Date.now() - t0,
    deal_id: dealId || null,
    song_id: songId || null,
    metadata: {
      bytes: bytes.length,
      label: label || null,
      batch: batchInfo ?? null,
    },
  });

  return jr({
    ok: true,
    path,
    signed_url: signed.signedUrl,
    signed_url_kind: signedUrlKind,
    expires_in: SIGNED_URL_TTL,
    batch: batchInfo,
  });
});
