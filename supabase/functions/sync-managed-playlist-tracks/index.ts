// sync-managed-playlist-tracks — busca via Spotify API as faixas atuais de uma
// managed_playlist e faz snapshot em public.managed_playlist_tracks (replace-all
// por playlist). Body: { playlist_id: uuid }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getSpotifyToken } from "../_shared/spotify.ts";
import { listPlaylistTracksRich } from "../_shared/spotify-playlist.ts";
import { requireTeamAccess } from "../_shared/auth.ts";
import {
  acquirePlaylistLock,
  finishPlaylistOperation,
  releasePlaylistLock,
  lockedResponseBody,
} from "../_shared/playlist-lock.ts";



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

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: any;
  try { body = await req.json(); } catch { return jr({ ok: false, error: "Invalid JSON" }, 400); }
  const playlist_id = String(body?.playlist_id ?? "").trim();
  const skipLock = body?.skip_lock === true;
  if (!playlist_id) return jr({ ok: false, error: "playlist_id obrigatório" }, 400);


  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: pl, error: plErr } = await supabase
    .from("managed_playlists")
    .select("id, spotify_playlist_id, name")
    .eq("id", playlist_id)
    .maybeSingle();
  if (plErr) return jr({ ok: false, error: plErr.message }, 500);
  if (!pl?.spotify_playlist_id) return jr({ ok: false, error: "playlist não encontrada" }, 404);

  // Conta atual antes do replace-all (best-effort)
  const { count: tracksBefore } = await supabase
    .from("managed_playlist_tracks")
    .select("*", { count: "exact", head: true })
    .eq("playlist_id", pl.id);

  const lock = skipLock
    ? null
    : await acquirePlaylistLock(supabase, pl.id, "AUTO_SYNC", tracksBefore ?? null);
  if (lock && !lock.ok) return jr(lockedResponseBody(lock), 423);


  try {
    const token = await getSpotifyToken();
    const rich = await listPlaylistTracksRich(pl.spotify_playlist_id, token, {
      max: 10000,
      fields: "items(added_at,track(id,name,duration_ms,artists(name),album(images))),next",
    });
    const rows = rich
      .filter((t) => t.spotify_track_id)
      .map((t) => ({
        playlist_id: pl.id,
        spotify_track_id: t.spotify_track_id,
        track_name: t.name || null,
        artist_name: t.artists || null,
        album_cover: t.album_cover,
        position: t.position - 1,
        added_at: t.added_at,
        duration_ms: t.duration_ms,
      }));

    // Replace-all por playlist (snapshot atual)
    const { error: delErr } = await supabase
      .from("managed_playlist_tracks")
      .delete()
      .eq("playlist_id", pl.id);
    if (delErr) throw new Error(`delete: ${delErr.message}`);

    if (rows.length > 0) {
      for (let i = 0; i < rows.length; i += 500) {
        const slice = rows.slice(i, i + 500);
        const { error: insErr } = await supabase
          .from("managed_playlist_tracks")
          .insert(slice);
        if (insErr) throw new Error(`insert ${i}: ${insErr.message}`);
      }
    }

    await supabase
      .from("managed_playlists")
      .update({ tracks_count: rows.length, last_metrics_at: new Date().toISOString() })
      .eq("id", pl.id);

    await finishPlaylistOperation(supabase, lock, {
      status: "success",
      tracks_before: tracksBefore ?? null,
      tracks_after: rows.length,
      tracks_changed: Math.abs((tracksBefore ?? 0) - rows.length),
    });
    return jr({ ok: true, total: rows.length });
  } catch (e) {
    await finishPlaylistOperation(supabase, lock, {
      status: "failed",
      tracks_before: tracksBefore ?? null,
      error: (e as Error).message,
    });
    return jr({ ok: false, error: (e as Error).message }, 500);
  } finally {
    await releasePlaylistLock(supabase, lock);
  }
});

