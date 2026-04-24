// track-playlist-metrics — Coleta seguidores atuais via Spotify API
// para cada playlist publicada (playlist_templates com spotify_playlist_id).
// Salva snapshot em playlist_metrics_snapshots.
// POST { template_ids?: string[], limit?: number }
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

async function fetchPlaylistMeta(token: string, id: string) {
  const r = await fetch(
    `https://api.spotify.com/v1/playlists/${id}?fields=followers.total,tracks.total`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) {
    if (r.status === 401) throw new Error("UNAUTH");
    return null;
  }
  const j = await r.json();
  return {
    followers: j?.followers?.total ?? 0,
    total_tracks: j?.tracks?.total ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: { template_ids?: string[]; limit?: number } = {};
  try { if (req.method === "POST") body = await req.json(); } catch { /* allow empty */ }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Carrega templates publicados
  let q = supabase
    .from("playlist_templates")
    .select("id, spotify_playlist_id, created_on_spotify_at, followers_at_creation")
    .not("spotify_playlist_id", "is", null);

  if (body.template_ids?.length) q = q.in("id", body.template_ids);
  q = q.limit(body.limit ?? 200);

  const { data: tpls, error } = await q;
  if (error) return jr({ error: error.message }, 500);
  if (!tpls?.length) return jr({ ok: true, processed: 0, snapshots: [] });

  let token: string;
  try { token = await getSpotifyToken(); } catch (e) {
    return jr({ error: `spotify_token: ${(e as Error).message}` }, 500);
  }

  const snapshots: any[] = [];
  let unauthRetried = false;
  let ok = 0, failed = 0;

  for (const tpl of tpls) {
    try {
      let meta = await fetchPlaylistMeta(token, tpl.spotify_playlist_id!).catch(async (e) => {
        if ((e as Error).message === "UNAUTH" && !unauthRetried) {
          unauthRetried = true;
          token = await getSpotifyToken(true);
          return fetchPlaylistMeta(token, tpl.spotify_playlist_id!);
        }
        throw e;
      });
      if (!meta) { failed++; continue; }

      const row = {
        template_id: tpl.id,
        spotify_playlist_id: tpl.spotify_playlist_id!,
        followers: meta.followers,
        total_tracks: meta.total_tracks,
      };
      const { error: insErr } = await supabase.from("playlist_metrics_snapshots").insert(row);
      if (insErr) { failed++; continue; }

      // Backfill followers_at_creation se ainda não existir
      if (tpl.followers_at_creation == null) {
        await supabase
          .from("playlist_templates")
          .update({ followers_at_creation: meta.followers })
          .eq("id", tpl.id);
      }
      snapshots.push(row);
      ok++;
      // pequeno delay
      await new Promise((r) => setTimeout(r, 60));
    } catch (e) {
      console.error("snapshot failed", tpl.id, e);
      failed++;
    }
  }

  await supabase.from("collection_logs").insert({
    acao: "track_playlist_metrics",
    status: failed === 0 ? "ok" : "parcial",
    mensagem: `snapshots ok=${ok} failed=${failed} total=${tpls.length}`,
  });

  return jr({ ok: true, processed: tpls.length, snapshots_ok: ok, failed });
});
