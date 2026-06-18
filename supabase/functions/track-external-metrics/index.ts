// track-external-metrics — Snapshot diário de seguidores/total_tracks
// para playlists ownership='external' AND monitored=true.
// Escreve em playlist_metrics_snapshots (mesma tabela usada pra próprias).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAppToken, forceRefreshAppToken } from "../_shared/spotify-client.ts";
import { requireTeamAccess } from "../_shared/auth.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";
import { getPlaylistMeta, SpotifyApiError } from "../_shared/spotify-playlist.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchMeta(token: string, id: string) {
  try {
    const meta = await getPlaylistMeta(id, token, { fields: "followers(total),tracks(total)" });
    return { followers: meta.followers ?? 0, total_tracks: meta.tracks_total ?? null };
  } catch (e) {
    if (e instanceof SpotifyApiError) {
      if (e.status === 401) throw new Error("UNAUTH");
      return null;
    }
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(body?.limit ?? 500, 1000);

  const { data: pls, error } = await supabase
    .from("playlists")
    .select("id, spotify_playlist_id, genre_id")
    .eq("ownership", "external")
    .eq("monitored", true)
    .limit(limit);
  if (error) return jr({ error: error.message }, 500);
  if (!pls?.length) return jr({ ok: true, processed: 0 });

  let token: string;
  try { token = await getAppToken(); }
  catch (e) { return jr({ error: `spotify_token: ${(e as Error).message}` }, 500); }

  let ok = 0, failed = 0, unauthRetried = false;

  for (const p of pls) {
    try {
      const meta = await fetchMeta(token, p.spotify_playlist_id).catch(async (e) => {
        if ((e as Error).message === "UNAUTH" && !unauthRetried) {
          unauthRetried = true;
          token = await forceRefreshAppToken();
          return fetchMeta(token, p.spotify_playlist_id);
        }
        throw e;
      });
      if (!meta) { failed++; continue; }

      const { error: insErr } = await supabase.from("playlist_metrics_snapshots").insert({
        spotify_playlist_id: p.spotify_playlist_id,
        followers: meta.followers,
        total_tracks: meta.total_tracks,
      });
      if (insErr) { failed++; continue; }

      // Atualiza followers atual em playlists
      await supabase.from("playlists").update({
        followers: meta.followers,
        last_seen_at: new Date().toISOString(),
      }).eq("id", p.id);

      ok++;
      await new Promise((r) => setTimeout(r, 60));
    } catch (e) {
      console.error("snap external failed", p.id, e);
      failed++;
    }
  }

  await supabase.from("collection_logs").insert({
    acao: "track_external_metrics",
    status: failed === 0 ? "ok" : "parcial",
    mensagem: `external snapshots ok=${ok} failed=${failed} total=${pls.length}`,
  });

  await reportCronHealth(supabase, {
    job_name: "track-external-metrics",
    status: failed === 0 ? "ok" : (ok === 0 ? "error" : "partial"),
    startedAt,
    metrics: { processed: pls.length, ok, failed },
  });

  return jr({ ok: true, processed: pls.length, snapshots_ok: ok, failed });
});
