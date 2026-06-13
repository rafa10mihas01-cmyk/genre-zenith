// GET /functions/v1/engine-health?genre_id=<uuid>
//
// Retorna a saúde dos sinais do motor editorial para um gênero.
// Layout do payload espelha o contrato consumido pelo Cockpit (grid R/A/G).
//
// Status thresholds:
//   recencia_variance:    ok > 20  | warn 10-20 | dead < 10
//   velocity_coverage:    ok > 70% | warn 30-70%| dead < 30%
//   leader_rel_variance:  ok > 15  | warn 5-15  | dead < 5

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAppToken } from "../_shared/spotify-client.ts";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type SignalStatus = "ok" | "warn" | "dead";
type Signal = { name: string; value: number; variance: number; status: SignalStatus };

const variance = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(v); // std-dev (mais legível como "variance" no payload)
};

const statusFor = (
  metric: "recencia_variance" | "velocity_coverage" | "leader_rel_variance",
  value: number,
): SignalStatus => {
  switch (metric) {
    case "recencia_variance":
      return value > 20 ? "ok" : value >= 10 ? "warn" : "dead";
    case "velocity_coverage":
      return value > 70 ? "ok" : value >= 30 ? "warn" : "dead";
    case "leader_rel_variance":
      return value > 15 ? "ok" : value >= 5 ? "warn" : "dead";
  }
};

const recenciaBuckets = (ageDays: number | null): number => {
  if (ageDays == null) return 40;
  if (ageDays <= 30) return 100;
  if (ageDays <= 90) return 85;
  if (ageDays <= 180) return 65;
  if (ageDays <= 365) return 40;
  if (ageDays <= 730) return 20;
  return 5;
};

async function buildHealth(supabase: any, genreId: string) {
  // 1) Pool top-40 por recorrência nos últimos 90 dias
  const ninetyAgoISO = new Date(Date.now() - 90 * 86400_000).toISOString();
  const { data: poolRows } = await supabase
    .from("search_tracks")
    .select("spotify_track_id, coletado_em")
    .eq("genre_id", genreId)
    .gte("coletado_em", ninetyAgoISO)
    .not("spotify_track_id", "is", null)
    .limit(5000);

  const counts = new Map<string, number>();
  let maxColetado = 0;
  for (const r of (poolRows ?? []) as any[]) {
    const id = String(r.spotify_track_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
    const ts = new Date(r.coletado_em).getTime();
    if (ts > maxColetado) maxColetado = ts;
  }
  const top40 = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);
  const top40Ids = top40.map(([id]) => id);

  // 2) Velocity coverage: % com row em genre_trends nos últimos 7d
  const sevenAgoISO = new Date(Date.now() - 7 * 86400_000).toISOString();
  let velocityCoveragePct = 0;
  if (top40Ids.length > 0) {
    const { data: trendRows } = await supabase
      .from("genre_trends")
      .select("track_id")
      .eq("genre_id", genreId)
      .in("track_id", top40Ids)
      .gte("updated_at", sevenAgoISO);
    const covered = new Set((trendRows ?? []).map((r: any) => String(r.track_id)));
    velocityCoveragePct = (covered.size / top40Ids.length) * 100;
  }

  // 3) Leader-rel variance: presença em top-N playlists do nicho
  const leaderCounts: number[] = [];
  if (top40Ids.length > 0) {
    const { data: nicheRows } = await supabase
      .from("search_results")
      .select("id, spotify_playlist_id, seguidores")
      .eq("genre_id", genreId)
      .not("spotify_playlist_id", "is", null)
      .not("seguidores", "is", null)
      .order("seguidores", { ascending: false })
      .limit(50);
    const seen = new Set<string>();
    const dedup: Array<{ id: string; pid: string }> = [];
    for (const r of (nicheRows ?? []) as any[]) {
      if (seen.has(r.spotify_playlist_id)) continue;
      seen.add(r.spotify_playlist_id);
      dedup.push({ id: r.id, pid: r.spotify_playlist_id });
    }
    const N = Math.min(10, dedup.length);
    const topResultIds = dedup.slice(0, N).map((d) => d.id);
    const resultToPid = new Map(dedup.slice(0, N).map((d) => [d.id, d.pid]));
    if (topResultIds.length > 0) {
      const { data: stRows } = await supabase
        .from("search_tracks")
        .select("spotify_track_id, result_id")
        .in("result_id", topResultIds)
        .in("spotify_track_id", top40Ids);
      const perTrack = new Map<string, Set<string>>();
      for (const r of (stRows ?? []) as any[]) {
        const pid = resultToPid.get(r.result_id);
        if (!pid) continue;
        const s = perTrack.get(r.spotify_track_id) ?? new Set<string>();
        s.add(pid);
        perTrack.set(r.spotify_track_id, s);
      }
      for (const id of top40Ids) {
        const set = perTrack.get(id);
        leaderCounts.push(((set?.size ?? 0) / Math.max(1, N)) * 100);
      }
    }
  }

  // 4) Recencia variance + fresh_pct
  // FASE APP-05: /v1/tracks foi restringido pelo Spotify (403). Metadata é
  // opcional — pulamos o fetch e tratamos como dado ausente (status warn).
  // Mantemos apenas o teste de token pra validar conectividade do app.
  const recenciaScores: number[] = [];
  const freshUnder365 = 0;
  let releaseFetched = 0;
  const releaseMap = new Map<string, string | null>();
  let tokenOk = false;
  try {
    await getAppToken({ functionName: "engine-health", operation: "health_check_token" });
    tokenOk = true;
  } catch (_e) {
    tokenOk = false;
  }
  const freshPct = 0;

  // 5) Pool ages
  const snapshotRow = await supabase
    .from("playlist_track_snapshots")
    .select("captured_at")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const snapshotAgeDays = snapshotRow.data?.captured_at
    ? Math.round((Date.now() - new Date(snapshotRow.data.captured_at).getTime()) / 86400_000)
    : 999;
  const searchTracksAgeDays = maxColetado > 0
    ? Math.round((Date.now() - maxColetado) / 86400_000)
    : 999;

  // 6) Diversidade — comparação entre as duas últimas runs em editorial_history
  // FASE APP-05: tracks_under_365d_pct dependia de /v1/tracks (restrito). Mantemos
  // só o cover_repeat_rate, que é puramente interno.
  let coverRepeatRate = 0;
  const tracksUnder365dPct = 0;
  const { data: histRows } = await supabase
    .from("editorial_history")
    .select("track_id, run_date")
    .eq("genre_id", genreId)
    .order("run_date", { ascending: false })
    .limit(50);
  if (histRows && histRows.length > 0) {
    const byDate = new Map<string, string[]>();
    for (const r of histRows as any[]) {
      const k = String(r.run_date);
      const arr = byDate.get(k) ?? [];
      arr.push(String(r.track_id));
      byDate.set(k, arr);
    }
    const dates = Array.from(byDate.keys()).sort().reverse();
    const latest = byDate.get(dates[0]) ?? [];
    const previous = dates[1] ? (byDate.get(dates[1]) ?? []) : [];
    if (latest.length > 0 && previous.length > 0) {
      const prevSet = new Set(previous);
      const repeats = latest.filter((id) => prevSet.has(id)).length;
      coverRepeatRate = (repeats / latest.length) * 100;
    }
  }

  // 7) Sinais
  const recenciaVar = variance(recenciaScores);
  const leaderRelVar = variance(leaderCounts);
  const signals: Signal[] = [
    {
      name: "recencia_variance",
      value: Math.round(recenciaVar * 100) / 100,
      variance: Math.round(recenciaVar * 100) / 100,
      status: statusFor("recencia_variance", recenciaVar),
    },
    {
      name: "velocity_coverage",
      value: Math.round(velocityCoveragePct * 10) / 10,
      variance: 0,
      status: statusFor("velocity_coverage", velocityCoveragePct),
    },
    {
      name: "leader_rel_variance",
      value: Math.round(leaderRelVar * 100) / 100,
      variance: Math.round(leaderRelVar * 100) / 100,
      status: statusFor("leader_rel_variance", leaderRelVar),
    },
  ];

  return {
    genre_id: genreId,
    generated_at: new Date().toISOString(),
    signals,
    pool: {
      fresh_pct: Math.round(freshPct * 10) / 10,
      snapshot_age_days: snapshotAgeDays,
      search_tracks_age_days: searchTracksAgeDays,
      top40_size: top40Ids.length,
      release_metadata_coverage: top40Ids.length
        ? Math.round((releaseFetched / top40Ids.length) * 100)
        : 0,
    },
    diversity: {
      cover_repeat_rate: Math.round(coverRepeatRate * 10) / 10,
      tracks_under_365d_pct: Math.round(tracksUnder365dPct * 10) / 10,
    },
    dead_signals: signals.filter((s) => s.status === "dead").map((s) => s.name),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;
  try {
    const url = new URL(req.url);
    const genreId = url.searchParams.get("genre_id");
    const all = url.searchParams.get("all") === "1";
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    if (!genreId && !all) {
      return new Response(
        JSON.stringify({ error: "missing genre_id (or ?all=1)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (all) {
      const { data: mp } = await supabase
        .from("managed_playlists")
        .select("genre_id")
        .not("genre_id", "is", null)
        .is("archived_at", null);
      const ids = Array.from(new Set((mp ?? []).map((r: any) => r.genre_id))).slice(0, 25);
      const results = await Promise.all(ids.map((id) => buildHealth(supabase, id).catch((e) => ({
        genre_id: id,
        error: String(e?.message ?? e),
      }))));
      return new Response(JSON.stringify({ items: results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await buildHealth(supabase, genreId!);
    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
