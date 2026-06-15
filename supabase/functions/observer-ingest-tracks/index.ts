// observer-ingest-tracks — Recebe tracks coletadas pelo bot observador da VPS.
// Auth: x-bot-token = BOT_INGEST_TOKEN.
// Body: { spotify_playlist_id, correlation_id?, tracks: [{ spotify_track_id, position, name, artist, album_name, album_cover_url, duration_ms }] }
import { createClient } from "npm:@supabase/supabase-js@2";
import { enqueuePlaylistJob } from "../_shared/playlist-queue.ts";

const DIAGNOSE_THROTTLE_HOURS = 6;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-bot-key, x-bot-token, x-worker-id, x-hostname",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BOT_INGEST_TOKEN = Deno.env.get("BOT_INGEST_TOKEN") ?? "";
const BOT_API_KEY = Deno.env.get("BOT_API_KEY") ?? "";

function authed(req: Request) {
  const got = (req.headers.get("x-bot-token") ?? req.headers.get("x-bot-key") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")).trim();
  return !!got && (got === BOT_INGEST_TOKEN || got === BOT_API_KEY);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!authed(req)) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

  const playlistId = String(body.spotify_playlist_id ?? "").trim();
  const tracks = Array.isArray(body.tracks) ? body.tracks : [];
  if (!playlistId || tracks.length === 0) {
    return new Response(JSON.stringify({ error: "missing_playlist_or_tracks" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const today = new Date().toISOString().slice(0, 10);
  const correlation = body.correlation_id ?? null;

  const rows = tracks
    .filter((t: any) => t && typeof t.spotify_track_id === "string" && t.spotify_track_id.length > 0)
    .map((t: any, idx: number) => ({
      spotify_playlist_id: playlistId,
      spotify_track_id: String(t.spotify_track_id),
      position: typeof t.position === "number" ? t.position : idx + 1,
      name: t.name ?? null,
      artist: t.artist ?? null,
      album_name: t.album_name ?? null,
      album_cover_url: t.album_cover_url ?? null,
      duration_ms: typeof t.duration_ms === "number" ? t.duration_ms : null,
      captured_date: today,
      correlation_id: correlation,
      raw: t.raw ?? null,
    }));

  const { error, count } = await supa
    .from("observer_playlist_tracks")
    .upsert(rows, { onConflict: "spotify_playlist_id,spotify_track_id,captured_date", count: "exact" });

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // Atualiza observed_playlists.last_observed_at
  await supa.from("observed_playlists")
    .update({ last_observed_at: new Date().toISOString() })
    .eq("spotify_playlist_id", playlistId);

  return new Response(JSON.stringify({ ok: true, inserted: rows.length, upserted: count }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
