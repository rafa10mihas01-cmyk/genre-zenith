// bot-upload-print — Recebe PNG do bot e armazena no bucket bot-prints (privado).
// Auth: header x-bot-key.
// POST multipart/form-data: file (PNG), deal_id, song_id, label?
// OU POST application/octet-stream com query ?deal_id=&song_id=&label=
// Retorna { ok, path, signed_url, expires_at }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-bot-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY")!;
const BUCKET = "bot-prints";
const SIGNED_URL_TTL = 60 * 60 * 24 * 365; // 1 ano

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);
  if (req.headers.get("x-bot-key") !== BOT_API_KEY) {
    return jr({ error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const ct = req.headers.get("content-type") ?? "";
  let bytes: Uint8Array | null = null;
  let dealId = url.searchParams.get("deal_id") ?? "";
  let songId = url.searchParams.get("song_id") ?? "";
  let label = url.searchParams.get("label") ?? "";

  try {
    if (ct.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const f = form.get("file");
      if (!(f instanceof File)) return jr({ error: "file required" }, 400);
      bytes = new Uint8Array(await f.arrayBuffer());
      dealId = (form.get("deal_id") as string) || dealId;
      songId = (form.get("song_id") as string) || songId;
      label = (form.get("label") as string) || label;
    } else {
      // raw body (octet-stream / image/png)
      const buf = await req.arrayBuffer();
      bytes = new Uint8Array(buf);
    }
  } catch (e) {
    return jr({ error: "invalid_body", detail: String(e) }, 400);
  }

  if (!bytes || bytes.length === 0) return jr({ error: "empty_file" }, 400);
  if (bytes.length > 8 * 1024 * 1024) return jr({ error: "file_too_large_8mb" }, 413);

  const dSeg = safeSeg(dealId, "no-deal");
  const sSeg = safeSeg(songId, "no-song");
  const lSeg = safeSeg(label, "print");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${dSeg}/${sSeg}/${ts}-${lSeg}.png`;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "image/png", upsert: false });
  if (upErr) return jr({ error: "upload_failed", detail: upErr.message }, 500);

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (signErr) return jr({ error: "sign_failed", detail: signErr.message }, 500);

  return jr({
    ok: true,
    path,
    signed_url: signed.signedUrl,
    expires_in: SIGNED_URL_TTL,
  });
});
