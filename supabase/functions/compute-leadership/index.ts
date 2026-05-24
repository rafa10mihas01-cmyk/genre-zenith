// Phase 3 — Compute leadership score per playlist.
// Combines: followers, growth (followers delta last 30d), activity (snapshots+tracks), benchmark presence.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { recencyWeight, normalize } from "../_shared/recency.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Number(body.limit ?? 2000);

    // Pull playlists with at least one genre confidence row.
    const { data: pls, error } = await supabase
      .from("playlists")
      .select("id, spotify_playlist_id, followers, last_seen_at, genre_id")
      .not("spotify_playlist_id", "is", null)
      .order("followers", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw error;
    if (!pls?.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const spIds = pls.map((p: any) => p.spotify_playlist_id);
    const since = new Date(Date.now() - 60 * 86400_000).toISOString();

    // Snapshots: pick last vs 30d ago to estimate growth + activity count.
    const { data: snaps } = await supabase
      .from("playlist_metrics_snapshots")
      .select("spotify_playlist_id, followers, collected_at")
      .in("spotify_playlist_id", spIds)
      .gte("collected_at", since)
      .order("collected_at", { ascending: false })
      .limit(50000);

    // Track activity weighted by recency.
    const { data: tracks } = await supabase
      .from("search_tracks")
      .select("spotify_playlist_id, coletado_em")
      .in("spotify_playlist_id", spIds)
      .gte("coletado_em", since)
      .limit(80000);

    const snapsByPl = new Map<string, Array<{ f: number; t: number }>>();
    for (const s of (snaps ?? []) as any[]) {
      const arr = snapsByPl.get(s.spotify_playlist_id) ?? [];
      arr.push({ f: s.followers ?? 0, t: new Date(s.collected_at).getTime() });
      snapsByPl.set(s.spotify_playlist_id, arr);
    }
    const activityByPl = new Map<string, number>();
    for (const t of (tracks ?? []) as any[]) {
      activityByPl.set(
        t.spotify_playlist_id,
        (activityByPl.get(t.spotify_playlist_id) ?? 0) + recencyWeight(t.coletado_em),
      );
    }

    // Freshness por playlist (vem de search_results pelo spotify_playlist_id).
    const { data: srFresh } = await supabase
      .from("search_results")
      .select("spotify_playlist_id, freshness_score")
      .in("spotify_playlist_id", spIds);
    const freshByPl = new Map<string, number>();
    for (const r of (srFresh ?? []) as any[]) {
      const cur = freshByPl.get(r.spotify_playlist_id) ?? 0;
      const v = Number(r.freshness_score) || 0;
      if (v > cur) freshByPl.set(r.spotify_playlist_id, v);
    }

    // Ceilings for normalization
    const maxFollowers = Math.max(1, ...pls.map((p: any) => p.followers ?? 0));
    let maxGrowth = 1;
    let maxActivity = 1;

    const computed = pls.map((p: any) => {
      const sps = snapsByPl.get(p.spotify_playlist_id) ?? [];
      let growth = 0;
      if (sps.length >= 2) {
        const newest = sps[0];
        const oldest = sps[sps.length - 1];
        const days = Math.max(1, (newest.t - oldest.t) / 86400_000);
        growth = ((newest.f - oldest.f) / Math.max(1, oldest.f)) * (30 / days);
      }
      const activity = activityByPl.get(p.spotify_playlist_id) ?? 0;
      if (growth > maxGrowth) maxGrowth = growth;
      if (activity > maxActivity) maxActivity = activity;
      return { p, growth, activity, snaps: sps.length };
    });

    const rows = computed.map(({ p, growth, activity, snaps }) => {
      // Log normalization elimina saturação no topo.
      const followerRank = normalize(Math.log10(1 + (p.followers ?? 0)), Math.log10(1 + maxFollowers));
      const growthRank = normalize(Math.max(0, growth), Math.max(0.01, maxGrowth));
      const activityRank = normalize(activity, maxActivity);
      const benchmarkRank = snaps > 3 ? 1.0 : snaps / 4;
      const freshnessRank = freshByPl.get(p.spotify_playlist_id) ?? 0;
      // Fórmula Fase 9: 35 followers + 20 growth + 20 activity + 10 benchmark + 15 freshness
      const leadership =
        0.35 * followerRank +
        0.20 * growthRank +
        0.20 * activityRank +
        0.10 * benchmarkRank +
        0.15 * freshnessRank;
      return {
        playlist_id: p.id,
        leadership_score: Number(leadership.toFixed(4)),
        follower_rank: Number(followerRank.toFixed(4)),
        growth_rank: Number(growthRank.toFixed(4)),
        activity_rank: Number(activityRank.toFixed(4)),
        benchmark_rank: Number(benchmarkRank.toFixed(4)),
        freshness_rank: Number(freshnessRank.toFixed(4)),
        evidence: { followers: p.followers ?? 0, growth_30d_pct: Number(growth.toFixed(4)), activity_weighted: Number(activity.toFixed(2)), snapshots: snaps, freshness: freshnessRank },
        calculated_at: new Date().toISOString(),
      };
    });


    // Upsert in batches
    let written = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      const { error: upErr } = await supabase
        .from("playlist_leadership")
        .upsert(slice, { onConflict: "playlist_id" });
      if (upErr) throw upErr;
      written += slice.length;
    }

    await reportCronHealth(supabase, {
      job_name: "compute-leadership",
      status: "ok",
      startedAt,
      metrics: { processed: written },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        processed: written,
        top: rows
          .sort((a, b) => b.leadership_score - a.leadership_score)
          .slice(0, 10)
          .map((r) => ({ playlist_id: r.playlist_id, score: r.leadership_score, ev: r.evidence })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    await reportCronHealth(supabase, {
      job_name: "compute-leadership",
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
