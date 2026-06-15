// diag-observer-extract — diagnóstico pontual: usa user-token OAuth (conta observadora)
// pra extrair tracklist de playlists externas e mede taxa real de sucesso.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getUserToken } from "../_shared/spotify-client.ts";
import { listPlaylistTracksRich } from "../_shared/spotify-playlist.ts";
import { requireTeamAccess } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const playlist_ids: string[] = Array.isArray(body?.playlist_ids) ? body.playlist_ids : [];
  const observer_user_id: string | undefined = body?.observer_user_id;
  const max = Math.max(1, Math.min(Number(body?.max ?? 300), 500));

  if (playlist_ids.length === 0) {
    return new Response(JSON.stringify({ error: "playlist_ids[] required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];
  let tokenInfo: any = null;
  try {
    const { token, row } = await getUserToken(observer_user_id);
    tokenInfo = { spotify_user_id: row.spotify_user_id, app_id: row.app_id };
    for (const pid of playlist_ids) {
      const t0 = Date.now();
      try {
        const tracks = await listPlaylistTracksRich(pid, token, {
          max,
          fields: "items(track(id,name,album(images),artists(name))),next",
        });
        const withId = tracks.filter((t) => t.spotify_track_id);
        const withCover = tracks.filter((t) => (t.album_images?.[0]?.url ?? t.album_cover) != null);
        results.push({
          playlist_id: pid,
          ok: true,
          tracks_total: tracks.length,
          tracks_with_id: withId.length,
          tracks_with_cover: withCover.length,
          elapsed_ms: Date.now() - t0,
        });
      } catch (e) {
        results.push({
          playlist_id: pid,
          ok: false,
          error: (e as Error).message?.slice(0, 240) ?? "unknown",
          elapsed_ms: Date.now() - t0,
        });
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: `token: ${(e as Error).message}` }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ok = results.filter((r) => r.ok).length;
  return new Response(JSON.stringify({
    ok: true,
    observer: tokenInfo,
    tested: results.length,
    succeeded: ok,
    failed: results.length - ok,
    success_rate: results.length > 0 ? ok / results.length : 0,
    results,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
