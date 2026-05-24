// Phase 4 — Detect cultural drift: re-run confidence, compare with stored
// previous_confidence, flag migrations, write history, and rotate playlists.genre_id
// when the leading genre changes by a margin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { recencyWeight } from "../_shared/recency.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DRIFT_MIN = 0.15;      // min absolute change in confidence to be a drift
const SWITCH_MARGIN = 0.10;  // new top must beat current primary by this much

interface GenreScore {
  genre_id: string;
  confidence: number;
  evidence: Record<string, unknown>;
}

/**
 * Recompute genre scores for a single playlist using the same 4 signals as
 * genre-confidence-calc, but locally so we can compare before/after in batch.
 *
 *  search_terms (35%) · track recurrence (30%) · artist dominance (15%) · SEO title (20%)
 */
async function scorePlaylist(
  supabase: ReturnType<typeof createClient>,
  pl: { id: string; spotify_playlist_id: string; name: string },
  genres: Array<{ id: string; nome: string; slug: string }>,
): Promise<GenreScore[]> {
  const scores = new Map<string, { search: number; track: number; artist: number; seo: number }>();
  for (const g of genres) scores.set(g.id, { search: 0, track: 0, artist: 0, seo: 0 });

  // 1) search_terms that found this playlist
  const { data: srs } = await supabase
    .from("search_results")
    .select("term_id, collected_at, search_terms!inner(genre_id)")
    .eq("spotify_playlist_id", pl.spotify_playlist_id)
    .limit(500);
  for (const r of (srs ?? []) as any[]) {
    const gid = r.search_terms?.genre_id;
    if (!gid || !scores.has(gid)) continue;
    scores.get(gid)!.search += recencyWeight(r.collected_at);
  }

  // 2) track recurrence in other playlists of each genre
  const { data: myTracks } = await supabase
    .from("search_tracks")
    .select("spotify_track_id, coletado_em")
    .eq("spotify_playlist_id", pl.spotify_playlist_id)
    .gte("coletado_em", new Date(Date.now() - 180 * 86400_000).toISOString())
    .limit(500);
  const trackIds = Array.from(new Set((myTracks ?? []).map((t: any) => t.spotify_track_id).filter(Boolean)));
  if (trackIds.length) {
    const { data: cross } = await supabase
      .from("search_tracks")
      .select("spotify_track_id, genre_id, coletado_em")
      .in("spotify_track_id", trackIds.slice(0, 300))
      .neq("spotify_playlist_id", pl.spotify_playlist_id)
      .gte("coletado_em", new Date(Date.now() - 180 * 86400_000).toISOString())
      .limit(5000);
    for (const c of (cross ?? []) as any[]) {
      if (!c.genre_id || !scores.has(c.genre_id)) continue;
      scores.get(c.genre_id)!.track += recencyWeight(c.coletado_em);
    }
  }

  // 3) SEO title (slug match)
  const titleNorm = (pl.name || "").toLowerCase();
  for (const g of genres) {
    if (!titleNorm) break;
    const slug = (g.slug || g.nome || "").toLowerCase();
    if (slug && titleNorm.includes(slug)) scores.get(g.id)!.seo += 1;
  }

  // Normalize per signal and combine
  const max = { search: 0, track: 0, artist: 0, seo: 0 };
  for (const s of scores.values()) {
    if (s.search > max.search) max.search = s.search;
    if (s.track > max.track) max.track = s.track;
    if (s.seo > max.seo) max.seo = s.seo;
  }
  const out: GenreScore[] = [];
  for (const [gid, s] of scores) {
    const search = max.search ? s.search / max.search : 0;
    const track = max.track ? s.track / max.track : 0;
    const seo = max.seo ? s.seo / max.seo : 0;
    const conf = 0.35 * search + 0.30 * track + 0.15 * s.artist + 0.20 * seo;
    if (conf > 0.05) out.push({ genre_id: gid, confidence: Number(conf.toFixed(4)), evidence: { search, track, seo } });
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Number(body.limit ?? 200);
    const onlyPlaylist: string | undefined = body.playlist_id;

    const { data: genres } = await supabase.from("genres").select("id, nome, slug");
    if (!genres?.length) throw new Error("no genres seeded");

    let q = supabase
      .from("playlists")
      .select("id, spotify_playlist_id, name, genre_id")
      .not("spotify_playlist_id", "is", null)
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (onlyPlaylist) q = q.eq("id", onlyPlaylist);
    const { data: pls } = await q;
    if (!pls?.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stats = { processed: 0, drifted: 0, switched: 0, history_rows: 0 };
    const switches: any[] = [];

    for (const pl of pls as any[]) {
      stats.processed++;
      const scored = await scorePlaylist(supabase, pl, genres as any);
      if (!scored.length) continue;

      // Load previous rows for this playlist
      const { data: prev } = await supabase
        .from("playlist_genres")
        .select("genre_id, confidence")
        .eq("playlist_id", pl.id);
      const prevMap = new Map<string, number>();
      for (const r of (prev ?? []) as any[]) prevMap.set(r.genre_id, Number(r.confidence) || 0);

      const top = scored[0];
      const prevTopConf = prevMap.get(top.genre_id) ?? 0;
      const drift = Math.abs(top.confidence - prevTopConf);
      const drifted = drift >= DRIFT_MIN;
      if (drifted) stats.drifted++;

      // Upsert refreshed scores
      const rows = scored.slice(0, 5).map((s, i) => ({
        playlist_id: pl.id,
        genre_id: s.genre_id,
        confidence: s.confidence,
        previous_confidence: prevMap.get(s.genre_id) ?? 0,
        drift_score: Number(Math.abs(s.confidence - (prevMap.get(s.genre_id) ?? 0)).toFixed(4)),
        migration_score: i === 0 ? Number(drift.toFixed(4)) : 0,
        is_primary: i === 0,
        source: "drift-detector",
        evidence: s.evidence,
        trend_shift: drifted && i === 0 ? (top.confidence > prevTopConf ? "rising" : "falling") : null,
        updated_at: new Date().toISOString(),
      }));
      await supabase.from("playlist_genres").upsert(rows, { onConflict: "playlist_id,genre_id" });

      // Switch primary genre if a NEW leader beats the current one by margin
      const currentPrimary = pl.genre_id as string | null;
      const newLeaderConf = top.confidence;
      const currentLeaderConf = currentPrimary ? (scored.find((x) => x.genre_id === currentPrimary)?.confidence ?? 0) : 0;

      if (top.genre_id !== currentPrimary && newLeaderConf - currentLeaderConf >= SWITCH_MARGIN) {
        await supabase.from("playlists").update({ genre_id: top.genre_id }).eq("id", pl.id);
        await supabase.from("playlist_genre_history").insert({
          playlist_id: pl.id,
          previous_genre_id: currentPrimary,
          new_genre_id: top.genre_id,
          previous_confidence: currentLeaderConf,
          new_confidence: newLeaderConf,
          drift_score: Number(drift.toFixed(4)),
          reason: "leading_genre_changed",
          evidence: { top3: scored.slice(0, 3), prev_primary_conf: currentLeaderConf },
        });
        stats.switched++;
        stats.history_rows++;
        switches.push({
          playlist_id: pl.id,
          name: pl.name,
          from: currentPrimary,
          to: top.genre_id,
          delta: Number((newLeaderConf - currentLeaderConf).toFixed(4)),
        });
      }
    }

    await reportCronHealth(supabase, {
      job_name: "detect-genre-drift",
      status: "ok",
      startedAt,
      metrics: stats,
    });
    return new Response(JSON.stringify({ ok: true, stats, switches: switches.slice(0, 20) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await reportCronHealth(supabase, {
      job_name: "detect-genre-drift",
      status: "error",
      startedAt,
      message: String(e),
    });
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
