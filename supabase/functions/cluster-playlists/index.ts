// Phase 3 — Cluster playlists by track overlap (Jaccard) within subgenre.
// Cron-friendly: runs over all subgenres with enough sample.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { recencyWeight } from "../_shared/recency.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface PlaylistTracks {
  playlist_id: string;
  spotify_playlist_id: string;
  followers: number;
  tracks: Set<string>;
  weight: number; // recency-weighted activity
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

async function clusterSubgenre(
  supabase: ReturnType<typeof createClient>,
  subgenre: { id: string; parent_genre_id: string | null; nome: string },
  threshold = 0.18,
  minSample = 4
) {
  // Pull playlists that have confidence >= 0.4 for this subgenre's parent genre.
  // (Subgenre attribution to playlist comes from Phase 5; for now use genre.)
  const { data: pg, error: pgErr } = await supabase
    .from("playlist_genres")
    .select("playlist_id, confidence")
    .eq("genre_id", subgenre.parent_genre_id)
    .gte("confidence", 0.4)
    .limit(500);
  if (pgErr) throw pgErr;
  if (!pg || pg.length < minSample) return { skipped: true, reason: "low_sample", count: pg?.length ?? 0 };

  const playlistIds = pg.map((r: any) => r.playlist_id);
  const { data: pls } = await supabase
    .from("playlists")
    .select("id, spotify_playlist_id, followers")
    .in("id", playlistIds);
  if (!pls) return { skipped: true, reason: "no_playlists" };

  const spIds = pls.map((p: any) => p.spotify_playlist_id).filter(Boolean);
  if (spIds.length < minSample) return { skipped: true, reason: "low_spotify_ids" };

  // Get tracks per playlist (last 180d, weighted)
  const { data: tracks } = await supabase
    .from("search_tracks")
    .select("spotify_playlist_id, spotify_track_id, coletado_em")
    .in("spotify_playlist_id", spIds)
    .gte("coletado_em", new Date(Date.now() - 180 * 86400_000).toISOString())
    .limit(50000);

  const byPlaylist = new Map<string, PlaylistTracks>();
  for (const p of pls as any[]) {
    byPlaylist.set(p.spotify_playlist_id, {
      playlist_id: p.id,
      spotify_playlist_id: p.spotify_playlist_id,
      followers: p.followers ?? 0,
      tracks: new Set(),
      weight: 0,
    });
  }
  for (const t of (tracks ?? []) as any[]) {
    const pl = byPlaylist.get(t.spotify_playlist_id);
    if (!pl || !t.spotify_track_id) continue;
    pl.tracks.add(t.spotify_track_id);
    pl.weight += recencyWeight(t.coletado_em);
  }

  const candidates = Array.from(byPlaylist.values()).filter((p) => p.tracks.size >= 5);
  if (candidates.length < minSample) return { skipped: true, reason: "too_few_with_tracks", count: candidates.length };

  // Greedy clustering: pick highest-weight seed, attach neighbors within threshold.
  candidates.sort((a, b) => b.weight - a.weight);
  const assigned = new Set<string>();
  const clusters: Array<{ seed: PlaylistTracks; members: Array<{ p: PlaylistTracks; sim: number }> }> = [];

  for (const seed of candidates) {
    if (assigned.has(seed.playlist_id)) continue;
    const members: Array<{ p: PlaylistTracks; sim: number }> = [{ p: seed, sim: 1.0 }];
    assigned.add(seed.playlist_id);
    for (const other of candidates) {
      if (assigned.has(other.playlist_id)) continue;
      const sim = jaccard(seed.tracks, other.tracks);
      if (sim >= threshold) {
        members.push({ p: other, sim });
        assigned.add(other.playlist_id);
      }
    }
    if (members.length >= 2) clusters.push({ seed, members });
  }

  // Wipe previous clusters for this subgenre, then upsert.
  await supabase.from("playlist_clusters").delete().eq("subgenre_id", subgenre.id);

  let inserted = 0;
  for (const c of clusters) {
    const avgSim = c.members.reduce((a, m) => a + m.sim, 0) / c.members.length;
    const topTracks = Array.from(c.seed.tracks).slice(0, 50);
    const { data: cl, error: clErr } = await supabase
      .from("playlist_clusters")
      .insert({
        subgenre_id: subgenre.id,
        genre_id: subgenre.parent_genre_id,
        label: `${subgenre.nome} · cluster ${inserted + 1}`,
        strength: Number(avgSim.toFixed(4)),
        sample_size: c.members.length,
        centroid: { seed_playlist_id: c.seed.playlist_id, top_tracks: topTracks },
      })
      .select("id")
      .single();
    if (clErr || !cl) continue;
    const rows = c.members.map((m) => ({
      cluster_id: (cl as any).id,
      playlist_id: m.p.playlist_id,
      similarity: Number(m.sim.toFixed(4)),
    }));
    await supabase.from("playlist_cluster_members").insert(rows);
    inserted++;
  }

  return { subgenre: subgenre.nome, clusters: inserted, candidates: candidates.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const onlySubgenreId: string | undefined = body.subgenre_id;

    let query = supabase.from("subgenres").select("id, parent_genre_id, nome").eq("ativo", true);
    if (onlySubgenreId) query = query.eq("id", onlySubgenreId);
    const { data: subs, error } = await query;
    if (error) throw error;

    const results: any[] = [];
    for (const s of (subs ?? []) as any[]) {
      try {
        results.push(await clusterSubgenre(supabase, s));
      } catch (e) {
        results.push({ subgenre: s.nome, error: String(e) });
      }
    }
    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
