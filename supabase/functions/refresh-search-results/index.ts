// refresh-search-results — Fase 9.
// Atualiza dados vivos de search_results (followers, cover, total_tracks)
// e grava snapshot temporal em playlist_followers_snapshots.
//
// Tiers (cadência):
//   leader  → diário     (24h)
//   medium  → semanal    (7d)
//   small   → quinzenal  (14d)
//
// Body opcional:
//   { tier?: "leader"|"medium"|"small"|"all", limit?: number }
//
// O tier é inferido por (followers atuais) OU presença em playlist_leadership ≥ 0.55.
// Quando tier vem no body, filtra só esses.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAppToken } from "../_shared/spotify-client.ts";
import { getPlaylistMeta, SpotifyApiError } from "../_shared/spotify-playlist.ts";
import { recencyFactor } from "../_shared/recency.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TIER_INTERVAL_HOURS: Record<string, number> = {
  leader: 24,
  medium: 24 * 7,
  small: 24 * 14,
};

function classifyTier(followers: number | null, isBoardLeader: boolean): "leader" | "medium" | "small" {
  if (isBoardLeader || (followers ?? 0) >= 100_000) return "leader";
  if ((followers ?? 0) >= 10_000) return "medium";
  return "small";
}

function nextDue(tier: string, ref = new Date()): string {
  const h = TIER_INTERVAL_HOURS[tier] ?? 24 * 7;
  return new Date(ref.getTime() + h * 3600_000).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const tierFilter: string | undefined = body.tier;
  const jobName = `refresh-search-results:${tierFilter ?? "auto"}`;
  try {
    const limit = Math.min(Number(body.limit ?? 80), 200);

    // 1) carrega leaders (playlist_leadership joinable via playlists.spotify_playlist_id)
    const { data: leaders } = await sb
      .from("playlist_leadership")
      .select("leadership_score, playlists!inner(spotify_playlist_id)")
      .gte("leadership_score", 0.55);
    const leaderSet = new Set<string>(
      (leaders ?? [])
        .map((r: any) => r.playlists?.spotify_playlist_id)
        .filter(Boolean),
    );

    // 2) candidatos: due (next_refresh_due passou OU é null), ordenados
    let q = sb
      .from("search_results")
      .select("id, spotify_playlist_id, seguidores, refresh_tier, next_refresh_due, last_refreshed_at, imagem_url, nome_playlist, total_musicas")
      .not("spotify_playlist_id", "is", null)
      .order("next_refresh_due", { ascending: true, nullsFirst: true })
      .limit(limit);
    if (tierFilter && tierFilter !== "all") q = q.eq("refresh_tier", tierFilter);
    const { data: cands, error: cErr } = await q;
    if (cErr) throw cErr;

    if (!cands?.length) {
      await reportCronHealth(sb, { job_name: jobName, status: "ok", startedAt, metrics: { processed: 0 } });
      return new Response(JSON.stringify({ ok: true, processed: 0, tier: tierFilter ?? "auto" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // dedupe por spotify_playlist_id (search_results pode ter múltiplas linhas por playlist)
    const seen = new Set<string>();
    const unique = cands.filter((c: any) => {
      if (seen.has(c.spotify_playlist_id)) return false;
      seen.add(c.spotify_playlist_id);
      return true;
    });

    const token = await getAppToken();

    let processed = 0;
    let failed = 0;
    const snapshotInserts: Array<{ playlist_spotify_id: string; followers: number | null; total_tracks: number | null }> = [];
    const now = new Date();

    for (const row of unique) {
      const spId = row.spotify_playlist_id as string;
      let meta;
      try {
        meta = await getPlaylistMeta(spId, token, {
          fields: "name,images,followers(total),tracks(total)",
        });
      } catch (e) {
        if (e instanceof SpotifyApiError && e.status === 404) {
          await sb.from("search_results").update({
            refresh_tier: "small",
            next_refresh_due: new Date(now.getTime() + 30 * 86400_000).toISOString(),
            last_refreshed_at: now.toISOString(),
          }).eq("id", row.id);
          continue;
        }
        console.error("getPlaylistMeta failed", spId, (e as any)?.status, String(e).slice(0, 200));
        failed++;
        continue;
      }
      try {
        const newFollowers: number | null = meta.followers ?? null;
        const totalTracks: number | null = meta.tracks_total ?? null;
        const cover: string | null = meta.cover_url;
        const name: string | null = meta.name || null;

        const prevFollowers = row.seguidores ?? null;
        const lastRefresh = row.last_refreshed_at ? new Date(row.last_refreshed_at) : null;
        const daysSince = lastRefresh ? Math.max(1, (now.getTime() - lastRefresh.getTime()) / 86400_000) : null;
        const growth = (newFollowers != null && prevFollowers != null) ? newFollowers - prevFollowers : null;
        const growthRate = (growth != null && daysSince) ? growth / daysSince : null;

        const tier = classifyTier(newFollowers, leaderSet.has(spId));

        // freshness_score (mantém update_velocity / track_change pra outras funções)
        const fRecency = 1; // acabou de refrescar
        const fGrowth = growthRate != null ? Math.max(0, Math.min(1, growthRate / 50)) : 0; // 50 followers/dia = 1
        const freshness = Number((0.55 * fRecency + 0.45 * fGrowth).toFixed(4));

        // Atualiza TODAS as linhas da mesma playlist (search_results pode duplicar)
        await sb.from("search_results").update({
          seguidores: newFollowers,
          nome_playlist: name,
          imagem_url: cover,
          total_musicas: totalTracks,
          previous_followers: prevFollowers,
          followers_growth: growth,
          followers_growth_rate: growthRate,
          freshness_score: freshness,
          refresh_tier: tier,
          last_refreshed_at: now.toISOString(),
          next_refresh_due: nextDue(tier, now),
          followers_verified_at: now.toISOString(),
        }).eq("spotify_playlist_id", spId);

        snapshotInserts.push({
          playlist_spotify_id: spId,
          followers: newFollowers,
          total_tracks: totalTracks,
        });

        processed++;
      } catch (e) {
        failed++;
        console.error("refresh failed", spId, String(e));
      }
    }

    // batch insert snapshots
    if (snapshotInserts.length) {
      const { error: sErr } = await sb.from("playlist_followers_snapshots").insert(snapshotInserts);
      if (sErr) console.error("snapshot insert:", sErr.message);
    }

    await reportCronHealth(sb, {
      job_name: jobName,
      status: failed > 0 ? "partial" : "ok",
      startedAt,
      metrics: { processed, failed, batch: unique.length, tier: tierFilter ?? "auto" },
    });
    return new Response(JSON.stringify({
      ok: true, processed, failed, tier: tierFilter ?? "auto", batch: unique.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    await reportCronHealth(sb, { job_name: jobName, status: "error", startedAt, message: String(e) });
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
