// observer-upload-failure — Recebe screenshot + html quando o bot falha ao raspar uma playlist.
// Auth: x-bot-token. Multipart NÃO; recebemos base64 pra simplificar transporte.
// Body: { spotify_playlist_id, correlation_id, reason, screenshot_b64?, html? }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-bot-key, x-bot-token, x-hostname",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BOT_INGEST_TOKEN = Deno.env.get("BOT_INGEST_TOKEN") ?? "";
const BOT_API_KEY = Deno.env.get("BOT_API_KEY") ?? "";

function authed(req: Request) {
  const got = (req.headers.get("x-bot-token") ?? req.headers.get("x-bot-key") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")).trim();
  return !!got && (got === BOT_INGEST_TOKEN || got === BOT_API_KEY);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/^data:[^;]+;base64,/, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!authed(req)) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

  const playlistId = String(body.spotify_playlist_id ?? "").trim() || "unknown";
  const correlation = String(body.correlation_id ?? Date.now()).trim();
  const reason = String(body.reason ?? "unknown");

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${playlistId}/${stamp}-${correlation}`;
  const uploaded: string[] = [];

  if (body.screenshot_b64) {
    const path = `${base}.png`;
    const { error } = await supa.storage.from("observer-failures").upload(path, b64ToBytes(body.screenshot_b64), {
      contentType: "image/png", upsert: true,
    });
    if (!error) uploaded.push(path);
  }
  if (body.html) {
    const path = `${base}.html`;
    const { error } = await supa.storage.from("observer-failures").upload(path, new TextEncoder().encode(body.html), {
      contentType: "text/html; charset=utf-8", upsert: true,
    });
    if (!error) uploaded.push(path);
  }

  await supa.from("bot_events").insert({
    bot_name: "playlist-observer",
    step: "scrape_playlist",
    status: "failed",
    message: reason.slice(0, 1000),
    correlation_id: correlation,
    metadata: { spotify_playlist_id: playlistId, evidence: uploaded },
  });

  return new Response(JSON.stringify({ ok: true, uploaded }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
