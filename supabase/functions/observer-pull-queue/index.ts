// observer-pull-queue — Returns a batch of playlists for the VPS observer bot to scrape.
// Auth: x-bot-token = BOT_INGEST_TOKEN (same as outros bots).
// Source: observed_playlists, excluindo blocklist e o que já foi capturado hoje em observer_playlist_tracks.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-bot-key, x-bot-token, x-worker-id, x-hostname",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "5", 10) || 5, 1), 25);

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const today = new Date().toISOString().slice(0, 10);

  // Playlists já capturadas hoje
  const { data: captured } = await supa
    .from("observer_playlist_tracks")
    .select("spotify_playlist_id")
    .eq("captured_date", today);
  const capturedSet = new Set((captured ?? []).map((r: any) => r.spotify_playlist_id));

  // Blocklist — a tabela usa coluna `id` (não `spotify_playlist_id`).
  // Contém placeholders algorítmicos do Spotify (discover_weekly, smart_shuffle, etc).
  const { data: blocked } = await supa.from("observed_playlists_blocklist").select("id");
  const blockedSet = new Set((blocked ?? []).map((r: any) => r.id));

  // Candidatos: round-robin temporal — playlists não observadas há mais tempo primeiro
  const { data: candidates, error } = await supa
    .from("observed_playlists")
    .select("spotify_playlist_id, playlist_name, total_plays_observed, last_observed_at")
    .order("last_observed_at", { ascending: true, nullsFirst: true })
    .limit(limit * 10);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const queue = (candidates ?? [])
    .filter((p: any) => p.spotify_playlist_id && !capturedSet.has(p.spotify_playlist_id) && !blockedSet.has(p.spotify_playlist_id))
    .slice(0, limit)
    .map((p: any) => ({
      spotify_playlist_id: p.spotify_playlist_id,
      playlist_name: p.playlist_name,
      url: `https://open.spotify.com/playlist/${p.spotify_playlist_id}`,
    }));

  return new Response(JSON.stringify({ ok: true, count: queue.length, queue }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
