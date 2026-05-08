// worker-bridge — gateway único para o worker da VPS persistir no Cloud
// SEM expor service_role na VPS. Auth: header x-agent-token (OPS_AGENT_TOKEN).
//
// POST { op, ...payload }
// Ops suportadas:
//   bot_event           → insert em bot_events
//   deal_snapshot       → insert em curator_deal_snapshots
//   deal_song_bump      → atualiza next_auto_collect_at na song
//   deal_song_error     → marca erro de coleta na song
//   deal_song_get       → lê song (campos necessários ao worker)
//   print_batch_get     → lê batch
//   print_batch_update  → patch em bot_print_batches
//   upload_print        → upload PNG (base64) em bot-prints + signed URL
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jr, requireAgentToken } from "../_shared/admin-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "bot-prints";
const SIGNED_URL_TTL = 60 * 60 * 24 * 365;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const guard = requireAgentToken(req);
  if (!guard.ok) return guard.resp;
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return jr({ error: "invalid_json" }, 400); }
  const op = String(body?.op ?? "").trim();
  if (!op) return jr({ error: "op_required" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    switch (op) {
      case "bot_event": {
        const { error } = await sb.from("bot_events").insert(body.payload ?? {});
        if (error) return jr({ error: error.message }, 500);
        return jr({ ok: true }, 200);
      }
      case "deal_snapshot": {
        const { data, error } = await sb.from("curator_deal_snapshots")
          .insert(body.payload ?? {}).select("id").single();
        if (error) return jr({ error: error.message }, 500);
        return jr({ ok: true, id: data?.id }, 200);
      }
      case "deal_song_bump": {
        const { song_id, interval_minutes } = body;
        if (!song_id) return jr({ error: "song_id_required" }, 400);
        const next = new Date(Date.now() + (Number(interval_minutes) || 1440) * 60_000).toISOString();
        const { error } = await sb.from("curator_deal_songs").update({
          last_auto_collect_at: new Date().toISOString(),
          next_auto_collect_at: next,
          auto_collect_status: "idle",
          auto_collect_error: null,
          queued_at: null,
        }).eq("id", song_id);
        if (error) return jr({ error: error.message }, 500);
        return jr({ ok: true, next_auto_collect_at: next }, 200);
      }
      case "deal_song_error": {
        const { song_id, error: msg } = body;
        if (!song_id) return jr({ error: "song_id_required" }, 400);
        const { error } = await sb.from("curator_deal_songs").update({
          auto_collect_status: "error",
          auto_collect_error: String(msg ?? "unknown").slice(0, 500),
          last_auto_collect_at: new Date().toISOString(),
        }).eq("id", song_id);
        if (error) return jr({ error: error.message }, 500);
        return jr({ ok: true }, 200);
      }
      case "deal_song_get": {
        const { song_id } = body;
        if (!song_id) return jr({ error: "song_id_required" }, 400);
        const { data, error } = await sb.from("curator_deal_songs")
          .select("id, deal_id, song_name, song_artist, song_spotify_url, spotify_track_id, baseline_plays, auto_collect_interval_minutes")
          .eq("id", song_id).maybeSingle();
        if (error) return jr({ error: error.message }, 500);
        return jr({ ok: true, song: data ?? null }, 200);
      }
      case "print_batch_get": {
        const { batch_id } = body;
        if (!batch_id) return jr({ error: "batch_id_required" }, 400);
        const { data, error } = await sb.from("bot_print_batches")
          .select("*").eq("id", batch_id).maybeSingle();
        if (error) return jr({ error: error.message }, 500);
        return jr({ ok: true, batch: data ?? null }, 200);
      }
      case "print_batch_update": {
        const { batch_id, patch } = body;
        if (!batch_id || !patch) return jr({ error: "batch_id_and_patch_required" }, 400);
        const { error } = await sb.from("bot_print_batches")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", batch_id);
        if (error) return jr({ error: error.message }, 500);
        return jr({ ok: true }, 200);
      }
      case "upload_print": {
        const { path, content_base64 } = body;
        if (!path || !content_base64) return jr({ error: "path_and_content_base64_required" }, 400);
        const bytes = b64ToBytes(content_base64);
        if (bytes.length > 10 * 1024 * 1024) return jr({ error: "file_too_large_10mb" }, 413);
        const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, {
          contentType: "image/png", upsert: true, cacheControl: "31536000",
        });
        if (upErr) return jr({ error: `upload_failed: ${upErr.message}` }, 500);
        let signed_url: string | null = null;
        for (let i = 0; i < 4; i++) {
          const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
          if (!error && data?.signedUrl) { signed_url = data.signedUrl; break; }
          await new Promise((r) => setTimeout(r, 300 * (i + 1)));
        }
        return jr({ ok: true, path, signed_url }, 200);
      }
      default:
        return jr({ error: `unknown_op:${op}` }, 400);
    }
  } catch (e: any) {
    return jr({ error: String(e?.message || e) }, 500);
  }
});
