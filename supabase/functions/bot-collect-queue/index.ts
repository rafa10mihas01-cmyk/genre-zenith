// bot-collect-queue — Devolve fila de campanhas com auto_collect=true prontas pra coletar.
// Auth: header x-bot-key (compara com env BOT_API_KEY).
// GET ?limit=5
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-bot-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.headers.get("x-bot-key") !== BOT_API_KEY) {
    return jr({ error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "5"), 1), 20);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Recovery: músicas presas em "queued" há mais de 10 min voltam pra "error"
  // (provavelmente bot crashou no meio do ciclo). Assim entram no próximo round.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await supabase
    .from("curator_deal_songs")
    .update({
      auto_collect_status: "error",
      auto_collect_error: "Stuck in queued >10min — auto-recovered",
    })
    .eq("auto_collect_status", "queued")
    .lt("updated_at", tenMinAgo);

  // Candidatas: auto_collect=true E (next_auto_collect_at <= now OR next null)
  // E (status idle OU error) — não pega running/queued
  const { data, error } = await supabase
    .from("curator_deal_songs")
    .select(`
      id, deal_id, song_name, song_artist, artist_candidates, song_spotify_url, spotify_track_id,
      auto_collect_status, last_auto_collect_at, next_auto_collect_at,
      auto_collect_interval_minutes, last_print_at,
      curator_deals!inner ( id, curator_name, song_name, user_id, closed_at ),
      curator_playlists ( id, playlist_name, spotify_url, spotify_playlist_id )
    `)
    .eq("auto_collect", true)
    .in("auto_collect_status", ["idle", "error"])
    .is("curator_deals.closed_at", null)
    .or(`next_auto_collect_at.is.null,next_auto_collect_at.lte.${new Date().toISOString()}`)
    .order("next_auto_collect_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) return jr({ error: error.message }, 500);

  // Marca como queued para evitar dupla execução
  const ids = (data ?? []).map((s) => s.id);
  if (ids.length) {
    await supabase
      .from("curator_deal_songs")
      .update({ auto_collect_status: "queued" })
      .in("id", ids);
  }

  return jr({ ok: true, count: ids.length, queue: data ?? [] });
});
