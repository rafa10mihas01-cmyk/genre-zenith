// backfill-curator-playlist-meta — enriquece curator_playlists que estão
// sem image_url/owner/followers chamando a Spotify Web API.
// POST { limit?: number, deal_id?: string }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchPlaylistMeta } from "../_shared/curator-playlist.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const limit = typeof body?.limit === "number" ? Math.min(body.limit, 500) : 200;
    const dealId = typeof body?.deal_id === "string" ? body.deal_id : null;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    let q = supabase
      .from("curator_playlists")
      .select("id, spotify_playlist_id, image_url, spotify_owner_id, followers")
      .not("spotify_playlist_id", "is", null)
      .or("image_url.is.null,spotify_owner_id.is.null,followers.is.null")
      .limit(limit);
    if (dealId) q = q.eq("deal_id", dealId);

    const { data: rows, error } = await q;
    if (error) return jr({ ok: false, error: error.message }, 500);

    let updated = 0, failed = 0, skipped = 0;
    const errors: string[] = [];
    for (const r of rows ?? []) {
      const sid = r.spotify_playlist_id as string | null;
      if (!sid) { skipped++; continue; }
      try {
        const meta = await fetchPlaylistMeta(sid);
        if (!meta) { failed++; errors.push(`${sid}: meta null`); continue; }
        const { error: upErr } = await supabase
          .from("curator_playlists")
          .update({
            image_url: meta.image_url,
            spotify_owner_id: meta.owner_id,
            spotify_owner_name: meta.owner_name,
            followers: meta.followers,
            playlist_name: meta.name,
          })
          .eq("id", r.id);
        if (upErr) { failed++; errors.push(`${sid}: ${upErr.message}`); continue; }
        updated++;
      } catch (e) {
        failed++;
        errors.push(`${sid}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return jr({ ok: true, total: rows?.length ?? 0, updated, failed, skipped, errors: errors.slice(0, 10) });
  } catch (e) {
    return jr({ ok: false, error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
