import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchPlaylistMeta } from "../_shared/curator-playlist.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-bot-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? "";
const BOT_API_KEY = Deno.env.get("BOT_API_KEY") ?? "";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function assertAccess(req: Request, dealId: string) {
  if (BOT_API_KEY && req.headers.get("x-bot-key") === BOT_API_KEY) return true;

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization || !ANON_KEY) return false;

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { authorization } },
  });
  const { data, error } = await userClient
    .from("curator_deals")
    .select("id")
    .eq("id", dealId)
    .maybeSingle();

  return !error && !!data?.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const dealId = String(body?.deal_id ?? "");
  const limit = Math.min(Math.max(Number(body?.limit ?? 80), 1), 200);
  if (!dealId) return json({ error: "deal_id_required" }, 400);
  if (!(await assertAccess(req, dealId))) return json({ error: "forbidden" }, 403);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: rows, error } = await supabase
    .from("curator_playlists")
    .select("id, spotify_playlist_id, image_url, spotify_owner_id, followers")
    .eq("deal_id", dealId)
    .not("spotify_playlist_id", "is", null)
    .not("spotify_playlist_id", "like", "algo:%")
    .or("image_url.is.null,spotify_owner_id.is.null,followers.is.null")
    .limit(limit);

  if (error) return json({ error: error.message }, 500);

  let updated = 0;
  const failed: Array<{ playlist_id: string; error: string }> = [];

  for (const row of rows ?? []) {
    const playlistId = String((row as any).spotify_playlist_id ?? "");
    if (!playlistId) continue;

    try {
      const meta = await fetchPlaylistMeta(playlistId);
      if (!meta) continue;

      const { error: updateError } = await supabase
        .from("curator_playlists")
        .update({
          playlist_name: meta.name,
          spotify_owner_id: meta.owner_id,
          spotify_owner_name: meta.owner_name,
          followers: meta.followers,
          image_url: meta.image_url,
        })
        .eq("id", (row as any).id);

      if (updateError) failed.push({ playlist_id: playlistId, error: updateError.message });
      else updated++;
    } catch (e) {
      failed.push({ playlist_id: playlistId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({ ok: true, scanned: rows?.length ?? 0, updated, failed });
});