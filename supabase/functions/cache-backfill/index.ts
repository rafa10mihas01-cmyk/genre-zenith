// cache-backfill — varre managed_playlist_tracks e enfileira IDs ainda não
// presentes em spotify_track_cache. Admin/team only.
//
// Body opcional: { playlist_id?: uuid, limit?: number }
//   - playlist_id: restringe a uma playlist específica (útil pra "esquentar"
//     uma playlist antes de rodar diagnose).
//   - limit: corta o total enfileirado nesta chamada (default 5000).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { enqueueEnrichment } from "../_shared/spotify-cache.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: any = {};
  try { body = await req.json(); } catch { /* opcional */ }
  const playlistId = body?.playlist_id ? String(body.playlist_id) : null;
  const limit = Math.max(1, Math.min(20000, Number(body?.limit ?? 5000)));

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) IDs distintos das managed_playlist_tracks
  let q = sb.from("managed_playlist_tracks").select("spotify_track_id, playlist_id");
  if (playlistId) q = q.eq("playlist_id", playlistId);
  const { data: tracks, error } = await q.limit(50000);
  if (error) return jr({ ok: false, error: error.message }, 500);

  const ids = Array.from(new Set((tracks ?? []).map((t: any) => t.spotify_track_id).filter(Boolean)));
  if (!ids.length) return jr({ ok: true, scanned: 0, missing: 0, enqueued: 0 });

  // 2) Quais já estão no cache?
  const present = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const slice = ids.slice(i, i + 500);
    const { data: rows } = await sb.from("spotify_track_cache").select("spotify_track_id").in("spotify_track_id", slice);
    for (const r of rows ?? []) present.add((r as any).spotify_track_id);
  }
  const missing = ids.filter((id) => !present.has(id)).slice(0, limit);

  await enqueueEnrichment("track", missing, "backfill", 8);

  return jr({ ok: true, scanned: ids.length, cached: present.size, missing: ids.length - present.size, enqueued: missing.length, playlist_id: playlistId });
});
