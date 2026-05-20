// playlist-tracks-list — lista faixas atuais de uma playlist via Spotify Web API.
// Body: { playlist_id: uuid }  (uuid de public.playlists)
// Retorna: { ok, tracks: [{ spotify_track_id, name, artists, album_cover, duration_ms, added_at }] }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getSpotifyToken } from "../_shared/spotify.ts";
import { requireTeamAccess } from "../_shared/auth.ts";

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
  try { body = await req.json(); } catch { return jr({ error: "Invalid JSON" }, 400); }
  const playlist_id = String(body?.playlist_id ?? "").trim();
  if (!playlist_id) return jr({ error: "playlist_id obrigatório" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: pl, error: plErr } = await supabase
    .from("playlists")
    .select("id, spotify_playlist_id")
    .eq("id", playlist_id)
    .maybeSingle();
  if (plErr) return jr({ ok: false, error: plErr.message }, 500);
  if (!pl?.spotify_playlist_id) {
    return jr({
      ok: false,
      code: "playlist_not_found",
      error: "playlist não encontrada",
      tracks: [],
      total: 0,
    });
  }

  try {
    const token = await getSpotifyToken();
    const out: any[] = [];
    let url: string | null =
      `https://api.spotify.com/v1/playlists/${pl.spotify_playlist_id}/items` +
      `?fields=items(added_at,track(id,name,duration_ms,artists(name),album(images))),next&limit=100`;
    while (url) {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`Spotify ${r.status}: ${txt.slice(0, 200)}`);
      }
      const j = await r.json();
      for (const it of j.items ?? []) {
        const tr = it?.track;
        if (!tr?.id) continue;
        const imgs = tr.album?.images ?? [];
        const cover = imgs[imgs.length - 1]?.url ?? imgs[0]?.url ?? null;
        out.push({
          spotify_track_id: tr.id,
          name: tr.name ?? "Unknown",
          artists: (tr.artists ?? []).map((a: any) => a?.name).filter(Boolean).join(", "),
          album_cover: cover,
          duration_ms: tr.duration_ms ?? null,
          added_at: it.added_at ?? null,
        });
      }
      url = j.next ?? null;
    }
    return jr({ ok: true, tracks: out, total: out.length });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
