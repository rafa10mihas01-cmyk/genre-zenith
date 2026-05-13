// genre-benchmarks-calc — Calcula percentis de seguidores/tracks por nicho,
// usando snapshots mais recentes das playlists ownership='external' monitored=true.
// Atualiza genre_benchmarks (1 linha por gênero, upsert).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

async function calcOne(supabase: any, genreId: string) {
  const { data: pls } = await supabase
    .from("playlists")
    .select("id, spotify_playlist_id, followers")
    .eq("genre_id", genreId)
    .eq("ownership", "external")
    .eq("monitored", true);

  if (!pls?.length) {
    return { genre_id: genreId, sample_size: 0, skipped: "sem_concorrentes" };
  }

  // Snapshot mais recente por playlist (followers + total_tracks).
  // Fallback pra coluna playlists.followers se não houver snapshot.
  const followersList: number[] = [];
  const tracksList: number[] = [];
  // Crescimento 30d: precisa snapshot atual + ~30d atrás
  const growthSamples: number[] = [];
  const cutoff30d = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  for (const p of pls) {
    const { data: snaps } = await supabase
      .from("playlist_metrics_snapshots")
      .select("followers, total_tracks, collected_at")
      .eq("spotify_playlist_id", p.spotify_playlist_id)
      .order("collected_at", { ascending: false })
      .limit(40);

    const arr = snaps ?? [];
    let f: number | null = null, t: number | null = null;
    if (arr.length > 0) {
      f = arr[0].followers ?? null;
      t = arr[0].total_tracks ?? null;
      // crescimento: snapshot mais antigo dentro/antes da janela 30d
      const old = arr.find((s: any) => s.collected_at <= cutoff30d) ?? arr[arr.length - 1];
      if (old && old.followers && f && old.followers > 0 && arr[0].collected_at !== old.collected_at) {
        growthSamples.push(((f - old.followers) / old.followers) * 100);
      }
    }
    if (f == null) f = p.followers ?? null;
    if (f != null && f > 0) followersList.push(f);
    if (t != null && t > 0) tracksList.push(t);
  }

  followersList.sort((a, b) => a - b);
  tracksList.sort((a, b) => a - b);

  const avgGrowth = growthSamples.length > 0
    ? growthSamples.reduce((a, b) => a + b, 0) / growthSamples.length
    : null;

  const payload = {
    genre_id: genreId,
    sample_size: followersList.length,
    followers_p50: percentile(followersList, 50),
    followers_p75: percentile(followersList, 75),
    followers_p90: percentile(followersList, 90),
    tracks_p50: percentile(tracksList, 50),
    tracks_p75: percentile(tracksList, 75),
    tracks_p90: percentile(tracksList, 90),
    avg_growth_pct_30d: avgGrowth,
    plays_per_follower_estimate: 0.05, // default; refinado em fase futura com dados de plays
    calculated_at: new Date().toISOString(),
    metadata: {
      growth_sample_size: growthSamples.length,
      tracks_sample_size: tracksList.length,
    },
  };

  const { error } = await supabase
    .from("genre_benchmarks")
    .upsert(payload, { onConflict: "genre_id" });
  if (error) throw new Error(error.message);

  return payload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    if (body?.genre_id) {
      return jr({ ok: true, mode: "single", result: await calcOne(supabase, body.genre_id) });
    }

    if (body?.batch === true) {
      const { data: genres } = await supabase
        .from("playlists")
        .select("genre_id")
        .eq("ownership", "external")
        .eq("monitored", true)
        .not("genre_id", "is", null);
      const uniq = Array.from(new Set((genres ?? []).map((g: any) => g.genre_id)));
      const results: any[] = [];
      for (const gid of uniq) {
        try { results.push(await calcOne(supabase, gid)); }
        catch (e) { results.push({ genre_id: gid, error: (e as Error).message }); }
      }
      return jr({ ok: true, mode: "batch", processed: results.length, results });
    }

    return jr({ ok: false, error: "informe genre_id ou batch:true" }, 400);
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
