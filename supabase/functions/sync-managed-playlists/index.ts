// sync-managed-playlists — sync completo das managed_playlists ATIVAS:
//   1. busca followers + tracks_count via Spotify Web API
//   2. atualiza managed_playlists
//   3. dispara playlist-brain-calc pra recalcular score
//   4. registra cada execução em sync_log
// Body: { playlist_id?: string, source?: string }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getSpotifyToken } from "../_shared/spotify.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchMeta(id: string, token: string) {
  const url = `https://api.spotify.com/v1/playlists/${id}?fields=followers(total),tracks(total),name,images,description`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const j = await r.json();
  return {
    followers: j?.followers?.total ?? 0,
    tracks_count: j?.tracks?.total ?? 0,
    name: j?.name ?? null,
    cover_url: Array.isArray(j?.images) && j.images[0]?.url ? j.images[0].url : null,
    description: j?.description ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const isCron = CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;
  if (!isCron) {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }

  const startedAt = Date.now();
  const body = await req.json().catch(() => ({}));
  const playlistId: string | undefined = body?.playlist_id;
  const source: string = isCron ? "cron" : (body?.source ?? "manual");
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let synced = 0, failed = 0, recalculated = 0;
  const errors: string[] = [];

  try {
    let q = supabase.from("managed_playlists")
      .select("id, spotify_playlist_id, canonical_playlist_id, name, cover_url")
      .is("archived_at", null);
    if (playlistId) q = q.eq("id", playlistId);
    const { data: pls, error } = await q;
    if (error) throw new Error(error.message);

    if (pls && pls.length > 0) {
      const token = await getSpotifyToken();
      const CONCURRENCY = 6;

      const processOne = async (p: typeof pls[number]) => {
        try {
          const meta = await fetchMeta(p.spotify_playlist_id, token);
          if (!meta) { failed++; return; }
          const update: Record<string, unknown> = {
            followers: meta.followers,
            tracks_count: meta.tracks_count,
            last_metrics_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          if (meta.name && meta.name !== p.name) update.name = meta.name;
          if (meta.cover_url && meta.cover_url !== p.cover_url) update.cover_url = meta.cover_url;
          let canonicalId = p.canonical_playlist_id;
          if (!canonicalId) {
            const { data: canonical, error: canonicalError } = await supabase
              .from("playlists")
              .upsert({
                spotify_playlist_id: p.spotify_playlist_id,
                name: meta.name ?? p.name,
                ownership: "own",
                source: "managed",
                followers: meta.followers,
                cover_url: meta.cover_url ?? p.cover_url,
                monitored: true,
                last_seen_at: new Date().toISOString(),
              }, { onConflict: "spotify_playlist_id" })
              .select("id")
              .single();
            if (canonicalError) throw new Error(canonicalError.message);
            canonicalId = canonical.id;
            update.canonical_playlist_id = canonicalId;
          } else {
            await supabase.from("playlists").update({
              name: meta.name ?? p.name,
              followers: meta.followers,
              cover_url: meta.cover_url ?? p.cover_url,
              ownership: "own",
              source: "managed",
              monitored: true,
              last_seen_at: new Date().toISOString(),
            }).eq("id", canonicalId);
          }

          await supabase.from("managed_playlists").update(update).eq("id", p.id);
          synced++;

          if (canonicalId) {
            // fire-and-forget pra não bloquear o sync
            fetch(`${SUPABASE_URL}/functions/v1/playlist-brain-calc`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
              body: JSON.stringify({ playlist_id: canonicalId }),
            }).then((r) => { if (r.ok) recalculated++; }).catch(() => {});
          }

          // também dispara snapshot das FAIXAS da playlist (fire-and-forget).
          // Sem isso, tracks_count atualiza mas managed_playlist_tracks fica defasada.
          fetch(`${SUPABASE_URL}/functions/v1/sync-managed-playlist-tracks`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ playlist_id: p.id }),
          }).catch(() => {});
        } catch (e) {
          failed++;
          errors.push(`${p.name}: ${(e as Error).message}`);
        }
      };

      // processa em chunks paralelos pra caber no timeout do edge function
      for (let i = 0; i < pls.length; i += CONCURRENCY) {
        const chunk = pls.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(processOne));
      }
    }


    await supabase.from("sync_log").insert({
      source, synced, failed, recalculated,
      errors: errors.length ? errors.slice(0, 20) : null,
      duration_ms: Date.now() - startedAt,
    });

    return jr({ ok: true, synced, failed, recalculated, errors: errors.slice(0, 5) });
  } catch (e) {
    await supabase.from("sync_log").insert({
      source, synced, failed, recalculated,
      errors: [(e as Error).message],
      duration_ms: Date.now() - startedAt,
    });
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
