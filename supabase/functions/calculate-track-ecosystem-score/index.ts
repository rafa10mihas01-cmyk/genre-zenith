// Wave 1 — Track Ecosystem Score calculator
// Modes:
//   POST {} or {mode:"full"} → recalcula todas as faixas
//   POST {mode:"single", track_id:"..."} → recalcula uma faixa
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------- Tunable thresholds ----------
const TH = {
  MIN_SNAPSHOTS_CONFIDENT: 4,
  GROWTH_SUBINDO_7D: 20,     // % crescimento 7d
  GROWTH_FORTE_28D: 50,      // % crescimento 28d
  GROWTH_CAINDO_28D: -15,    // % crescimento 28d
  STABLE_BAND_28D: 10,       // |growth_28d| <= 10 → estavel
  SATURATED_GROWTH_MAX: 5,   // crescimento abaixo disso + presença alta → saturada
  HIGH_PRESENCE_PERCENTILE: 0.80, // top 20% de presença = alta
};

type Snap = { plays: number | null; plays_7d: number | null; plays_28d: number | null; captured_at: string };

function pct(curr: number, prev: number): number | null {
  if (!prev || prev <= 0) return null;
  return ((curr - prev) / prev) * 100;
}

function classify(opts: {
  confidence: number;
  growth_7d: number | null;
  growth_28d: number | null;
  acceleration: number | null;
  presence_high: boolean;
  presence_low: boolean;
}): string {
  const { confidence, growth_7d, growth_28d, acceleration, presence_high, presence_low } = opts;
  if (confidence < 0.3) return "sem_dados";
  if (growth_28d !== null && growth_28d < TH.GROWTH_CAINDO_28D) return "caindo";
  if (presence_high && (growth_28d ?? 0) < TH.SATURATED_GROWTH_MAX) return "saturada";
  if (growth_7d !== null && growth_7d > TH.GROWTH_SUBINDO_7D && (acceleration ?? 0) > 0) return "subindo";
  if (growth_28d !== null && growth_28d > TH.GROWTH_FORTE_28D && !presence_low) return "forte";
  if (growth_28d !== null && Math.abs(growth_28d) <= TH.STABLE_BAND_28D) return "estavel";
  if (presence_low && (growth_28d ?? 0) <= 0) return "fraca";
  return "estavel";
}

async function processTrack(
  supabase: ReturnType<typeof createClient>,
  trackId: string,
  presenceHighThreshold: number,
): Promise<{ ok: boolean; error?: string }> {
  // Buscar metadata da faixa (do primeiro deal_song que a referencia)
  const { data: songRow } = await supabase
    .from("curator_deal_songs")
    .select("song_name, song_artist")
    .eq("spotify_track_id", trackId)
    .limit(1)
    .maybeSingle();

  // Deals + songs ligados a essa faixa
  const { data: songIds } = await supabase
    .from("curator_deal_songs")
    .select("id, deal_id")
    .eq("spotify_track_id", trackId);

  const ids = (songIds ?? []).map((s: any) => s.id);
  const dealIds = Array.from(new Set((songIds ?? []).map((s: any) => s.deal_id)));

  // Conta deals ativos (reconciled_total_plays é pouco confiável — pode estar 0).
  let reconciledTotal = 0;
  let deal_active_count = 0;
  if (dealIds.length > 0) {
    const { data: dealRows } = await supabase
      .from("curator_deals")
      .select("reconciled_total_plays, closed_at")
      .in("id", dealIds as any);
    for (const d of (dealRows ?? []) as any[]) {
      reconciledTotal += Number(d.reconciled_total_plays ?? 0);
      if (!d.closed_at) deal_active_count++;
    }
  }

  // Snapshots: `plays` é cumulativo por (song, playlist), então pegamos o ÚLTIMO
  // snapshot de cada par e somamos. Somar tudo direto causa double-count.
  type Snap = { song_id: string; playlist_id: string; plays: number; plays_7d: number; plays_28d: number; captured_at: string };
  const allSnaps: Snap[] = [];
  let lastSnapshotAt: string | null = null;
  if (ids.length > 0) {
    const since = new Date(Date.now() - 35 * 86400_000).toISOString();
    const PAGE = 1000;
    for (let from = 0; from < 30000; from += PAGE) {
      const { data: snapRows, error: snapErr } = await supabase
        .from("curator_deal_snapshots")
        .select("song_id, playlist_id, plays, plays_7d, plays_28d, captured_at")
        .in("song_id", ids)
        .gte("captured_at", since)
        .order("captured_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (snapErr) break;
      const rows = (snapRows ?? []) as any[];
      if (rows.length === 0) break;
      if (!lastSnapshotAt) lastSnapshotAt = rows[0]?.captured_at ?? null;
      for (const r of rows) {
        allSnaps.push({
          song_id: r.song_id,
          playlist_id: r.playlist_id,
          plays: Number(r.plays ?? 0),
          plays_7d: Number(r.plays_7d ?? 0),
          plays_28d: Number(r.plays_28d ?? 0),
          captured_at: r.captured_at,
        });
      }
      if (rows.length < PAGE) break;
    }
  }
  const snapshotsUsed = allSnaps.length;

  // Latest por (song, playlist) — totais atuais
  const latestPerPair = new Map<string, Snap>();
  for (const s of allSnaps) {
    const key = `${s.song_id}|${s.playlist_id}`;
    const ex = latestPerPair.get(key);
    if (!ex || s.captured_at > ex.captured_at) latestPerPair.set(key, s);
  }
  let streams_total_from_snaps = 0;
  let streams_7d = 0;
  let streams_28d = 0;
  for (const s of latestPerPair.values()) {
    streams_total_from_snaps += s.plays;
    streams_7d += s.plays_7d;
    streams_28d += s.plays_28d;
  }
  const streams_total = Math.max(reconciledTotal, streams_total_from_snaps);

  // Daily agg para growth: por dia, latest-por-playlist daquele dia, soma.
  const dayPairLatest = new Map<string, Map<string, Snap>>();
  const distinctDaysSet = new Set<string>();
  for (const s of allSnaps) {
    const day = s.captured_at.slice(0, 10);
    distinctDaysSet.add(day);
    let pairMap = dayPairLatest.get(day);
    if (!pairMap) { pairMap = new Map(); dayPairLatest.set(day, pairMap); }
    const key = `${s.song_id}|${s.playlist_id}`;
    const ex = pairMap.get(key);
    if (!ex || s.captured_at > ex.captured_at) pairMap.set(key, s);
  }
  const dailyAgg = [...dayPairLatest.entries()]
    .map(([day, m]) => ({ day, total: [...m.values()].reduce((a, b) => a + b.plays, 0) }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
  const distinctDays = distinctDaysSet.size;
  const latestDay = dailyAgg[0];
  const findDayAround = (n: number) => {
    const cutoff = Date.now() - n * 86400_000;
    return dailyAgg.find((d) => new Date(d.day).getTime() <= cutoff);
  };
  const ref7 = findDayAround(7);
  const ref28 = findDayAround(28);
  const growth_7d_pct = latestDay && ref7 && ref7.total > 0 ? pct(latestDay.total, ref7.total) : null;
  const growth_28d_pct = latestDay && ref28 && ref28.total > 0 ? pct(latestDay.total, ref28.total) : null;
  const acceleration =
    growth_7d_pct !== null && growth_28d_pct !== null ? growth_7d_pct - growth_28d_pct : null;

  // Presença em curator_playlists (via song_id)
  let curator_playlist_count = 0;
  if (ids.length > 0) {
    const { count } = await supabase
      .from("v_curator_playlists_operational")
      .select("id", { count: "exact", head: true })
      .in("song_id", ids);
    curator_playlist_count = count ?? 0;
  }
  const managed_playlist_count = 0; // sem join table track↔managed_playlist ainda
  const total_playlist_count = curator_playlist_count + managed_playlist_count;

  // Confidence baseado em quantos dias distintos temos (não em qtd bruta de snapshots)
  const confidence = Math.min(1, distinctDays / TH.MIN_SNAPSHOTS_CONFIDENT);
  const presence_high = total_playlist_count >= presenceHighThreshold && presenceHighThreshold > 0;
  const presence_low = total_playlist_count <= 1;
  const frequency_score = Math.min(1, total_playlist_count / Math.max(1, presenceHighThreshold || 10));
  const sat_growth = growth_28d_pct ?? 0;
  const saturation_index = presence_high
    ? Math.max(0, Math.min(1, (TH.SATURATED_GROWTH_MAX - sat_growth) / 100))
    : 0;

  const momentum_class = classify({
    confidence,
    growth_7d: growth_7d_pct,
    growth_28d: growth_28d_pct,
    acceleration,
    presence_high,
    presence_low,
  });

  const { error } = await supabase
    .from("track_ecosystem_score")
    .upsert(
      {
        spotify_track_id: trackId,
        track_name: songRow?.song_name ?? null,
        artist_name: songRow?.song_artist ?? null,
        streams_total,
        streams_7d,
        streams_28d,
        growth_7d_pct,
        growth_28d_pct,
        acceleration,
        managed_playlist_count,
        curator_playlist_count,
        total_playlist_count,
        deal_active_count,
        saturation_index,
        frequency_score,
        momentum_class,
        confidence,
        snapshots_used: snapshotsUsed,
        last_snapshot_at: lastSnapshotAt,
        calculated_at: new Date().toISOString(),
      },
      { onConflict: "spotify_track_id" },
    );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode = body?.mode ?? "full";

    // Calcular threshold de presença alta (percentil 80) sobre faixas conhecidas
    const { data: presenceStats } = await supabase
      .from("v_curator_playlists_operational")
      .select("song_id");
    const presenceMap = new Map<string, number>();
    for (const r of (presenceStats ?? []) as any[]) {
      if (!r.song_id) continue;
      presenceMap.set(r.song_id, (presenceMap.get(r.song_id) ?? 0) + 1);
    }
    const counts = [...presenceMap.values()].sort((a, b) => a - b);
    const presenceHighThreshold = counts.length
      ? counts[Math.floor(counts.length * TH.HIGH_PRESENCE_PERCENTILE)] ?? 0
      : 0;

    if (mode === "single") {
      const trackId = body?.track_id;
      if (!trackId) {
        return new Response(JSON.stringify({ error: "track_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await processTrack(supabase, trackId, presenceHighThreshold);
      return new Response(JSON.stringify({ mode, trackId, ...result }), {
        status: result.ok ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // FULL mode
    const { data: distinctTracks } = await supabase
      .from("curator_deal_songs")
      .select("spotify_track_id")
      .not("spotify_track_id", "is", null);

    const tracks = Array.from(
      new Set((distinctTracks ?? []).map((r: any) => r.spotify_track_id).filter(Boolean)),
    );

    let ok = 0;
    let failed = 0;
    const errors: string[] = [];
    const BATCH = 10;
    for (let i = 0; i < tracks.length; i += BATCH) {
      const slice = tracks.slice(i, i + BATCH);
      const results = await Promise.all(
        slice.map((t) => processTrack(supabase, t, presenceHighThreshold)),
      );
      for (const r of results) {
        if (r.ok) ok++;
        else {
          failed++;
          if (errors.length < 10 && r.error) errors.push(r.error);
        }
      }
    }

    return new Response(
      JSON.stringify({
        mode: "full",
        total: tracks.length,
        ok,
        failed,
        presenceHighThreshold,
        sampleErrors: errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
