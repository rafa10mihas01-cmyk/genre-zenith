// sync-managed-playlists — sync completo das managed_playlists:
//   1. busca followers + tracks_count via Spotify Web API
//   2. atualiza managed_playlists
//   3. dispara playlist-brain-calc pra recalcular score
// Body: { playlist_id?: string }  (sem id = todas as não arquivadas)
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getSpotifyToken } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const playlistId: string | undefined = body?.playlist_id;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    let q = supabase.from("managed_playlists")
      .select("id, spotify_playlist_id, canonical_playlist_id, name, cover_url")
      .is("archived_at", null);
    if (playlistId) q = q.eq("id", playlistId);
    const { data: pls, error } = await q;
    if (error) return jr({ ok: false, error: error.message }, 500);
    if (!pls || pls.length === 0) return jr({ ok: true, synced: 0, recalculated: 0 });

    const token = await getSpotifyToken();
    let synced = 0, failed = 0, recalculated = 0;
    const errors: string[] = [];

    for (const p of pls) {
      try {
        const meta = await fetchMeta(p.spotify_playlist_id, token);
        if (!meta) { failed++; continue; }
        const update: Record<string, unknown> = {
          followers: meta.followers,
          tracks_count: meta.tracks_count,
          last_metrics_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        // só sobrescreve nome/capa se vier do Spotify e estiver diferente/faltando
        if (meta.name && meta.name !== p.name) update.name = meta.name;
        if (meta.cover_url && meta.cover_url !== p.cover_url) update.cover_url = meta.cover_url;
        await supabase.from("managed_playlists").update(update).eq("id", p.id);
        synced++;

        if (p.canonical_playlist_id) {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/playlist-brain-calc`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ playlist_ids: [p.canonical_playlist_id] }),
          });
          if (r.ok) recalculated++;
        }
      } catch (e) {
        failed++;
        errors.push(`${p.name}: ${(e as Error).message}`);
      }
    }

    return jr({ ok: true, synced, failed, recalculated, errors: errors.slice(0, 5) });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
