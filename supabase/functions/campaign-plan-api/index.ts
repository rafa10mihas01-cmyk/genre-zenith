// Public API: full campaign plan with daily matrix (cell-by-cell)
// Auth: ?token=<public_plan_token>  OR  Authorization: Bearer <public_plan_token>
//
// Returns the same data shown in the "Plano completo da campanha" card:
// track info + spotify link, snapshot, per-playlist daily streams, totals.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ============================================================
// Port of src/lib/campaignOperationalPlan.ts — eco plan only
// (kept in sync with the front-end logic)
// ============================================================
const POSITION_PCT: number[] = [
  0.12, 0.10, 0.08, 0.07, 0.06,
  0.05, 0.045, 0.04, 0.035, 0.03,
  0.02, 0.018, 0.016, 0.014, 0.013,
  0.012, 0.011, 0.010, 0.009, 0.008,
];
const POSITION_RESIDUAL = 0.003;
const MIN_CAMPAIGN_POSITION = 3;
const ECO_RAMP = [0.2, 0.4, 0.6, 0.8, 1.0];
const WEEKDAY_FACTOR = [1.167, 0.833, 1.000, 1.167, 1.333, 1.500, 1.600];
const WEEKDAY_FLAT_FACTOR = [0.92, 0.85, 1.00, 1.04, 1.06, 1.08, 1.05];

function getPositionPct(pos: number) {
  if (pos < 1) return 0;
  return POSITION_PCT[pos - 1] ?? POSITION_RESIDUAL;
}
function calculatePlaylistCapacity(saves: number, mult = 30) {
  return Math.max(0, saves) * (Math.max(1, mult) / 30);
}
function calculateTrackDailyStreams(saves: number, mult: number, pos: number) {
  return calculatePlaylistCapacity(saves, mult) * getPositionPct(pos);
}
function seededRng(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Tier = "large" | "medium" | "small";
function classifyPlaylistSize(f: number): Tier {
  if (f >= 50000) return "large";
  if (f >= 10000) return "medium";
  return "small";
}
const POSITION_BUCKETS: Record<Tier, Array<[number, number, number]>> = {
  large:  [[3, 5, 0.70], [6, 8, 0.20], [9, 12, 0.10]],
  medium: [[3, 5, 0.20], [6, 10, 0.60], [11, 15, 0.20]],
  small:  [[3, 5, 0.10], [6, 10, 0.30], [11, 20, 0.60]],
};
function pickBucket(rng: () => number, tier: Tier): [number, number] {
  const r = rng(); let acc = 0;
  for (const [lo, hi, p] of POSITION_BUCKETS[tier]) {
    acc += p;
    if (r <= acc) return [lo, hi];
  }
  const last = POSITION_BUCKETS[tier][POSITION_BUCKETS[tier].length - 1];
  return [last[0], last[1]];
}
function maxViablePosition(planned: number, days: number, followers: number, mult: number) {
  if (planned <= 0 || days <= 0 || followers <= 0) return POSITION_PCT.length;
  const dailyTraffic = followers * (mult / 30);
  const dailyNeed = planned / days;
  if (dailyTraffic <= 0) return MIN_CAMPAIGN_POSITION;
  let best = MIN_CAMPAIGN_POSITION;
  for (let i = MIN_CAMPAIGN_POSITION - 1; i < POSITION_PCT.length; i++) {
    if (POSITION_PCT[i] * dailyTraffic >= dailyNeed) best = i + 1;
  }
  return best;
}
type ChartTier = "top50" | "top100" | "outside";
function chartTierFromTopPosition(top?: number | null): ChartTier {
  const p = Number(top ?? 0);
  if (p > 0 && p <= 50) return "top50";
  if (p > 50 && p <= 100) return "top100";
  return "outside";
}
const PRIMARY_RANGES_BY_CHART: Record<ChartTier, Record<"large" | "medium" | "small", [number, number]>> = {
  top50:   { large: [1, 1], medium: [1, 1], small: [1, 1] },
  top100:  { large: [1, 2], medium: [2, 4], small: [3, 5] },
  outside: { large: [1, 1], medium: [1, 1], small: [1, 1] },
};
const NEIGHBOR_RANGE_BY_CHART: Record<ChartTier, [number, number]> = {
  top50: [4, 5], top100: [5, 7], outside: [7, 10],
};
function distributeEcoPositions(
  allocs: Array<{ id: string; planned_streams: number; followers: number; genreSource?: "primary" | "affinity" }>,
  days: number,
  mult = 30,
  opts: { chartTier?: ChartTier } = {},
): Map<string, number> {
  if (opts.chartTier) {
    const out = new Map<string, number>();
    const primary = allocs.filter(a => (a.genreSource ?? "primary") === "primary").sort((a, b) => b.followers - a.followers);
    const affinity = allocs.filter(a => a.genreSource === "affinity").sort((a, b) => b.followers - a.followers);
    if (opts.chartTier === "outside") {
      const N = Math.max(1, primary.length);
      primary.forEach((a, i) => out.set(a.id, Math.max(1, Math.min(20, Math.round(((i + 1) / N) * 20)))));
    } else {
      const byTier: Record<"large" | "medium" | "small", typeof primary> = { large: [], medium: [], small: [] };
      for (const a of primary) byTier[classifyPlaylistSize(a.followers)].push(a);
      for (const t of ["large", "medium", "small"] as const) {
        const list = byTier[t];
        const [lo, hi] = PRIMARY_RANGES_BY_CHART[opts.chartTier][t];
        list.forEach((a, idx) => {
          const pct = list.length <= 1 ? 0 : idx / (list.length - 1);
          out.set(a.id, lo + Math.round(pct * (hi - lo)));
        });
      }
    }
    const [nlo, nhi] = NEIGHBOR_RANGE_BY_CHART[opts.chartTier];
    affinity.forEach((a, idx) => {
      const pct = affinity.length <= 1 ? 0 : idx / (affinity.length - 1);
      out.set(a.id, nlo + Math.round(pct * (nhi - nlo)));
    });
    return out;
  }
  // Legacy fallback
  const cap = 0.4;
  const total = allocs.length;
  const maxStrong = Math.max(1, Math.floor(total * cap));
  const ordered = [...allocs].sort((a, b) => b.followers - a.followers);
  const result = new Map<string, number>();
  let strongUsed = 0;
  for (const a of ordered) {
    const tier = classifyPlaylistSize(a.followers);
    const rng = seededRng(`pos:${a.id}`);
    let [lo, hi] = pickBucket(rng, tier);
    if (lo <= 5 && strongUsed >= maxStrong) {
      const rest = POSITION_BUCKETS[tier].filter(b => b[0] > 5);
      if (rest.length) {
        const sum = rest.reduce((s, b) => s + b[2], 0);
        const r = rng(); let acc = 0;
        for (const [blo, bhi, p] of rest) {
          acc += p / sum;
          if (r <= acc) { lo = blo; hi = bhi; break; }
        }
      } else { lo = 6; hi = 10; }
    }
    const candidate = lo + Math.floor(rng() * (hi - lo + 1));
    const viable = maxViablePosition(a.planned_streams, days, a.followers, mult);
    const pos = Math.max(MIN_CAMPAIGN_POSITION, Math.min(candidate, viable));
    if (pos <= 5) strongUsed++;
    result.set(a.id, pos);
  }
  return result;
}
function curveThresholdDay(curva: Array<{ streamsDay: number }>, pct: number) {
  if (!curva.length) return 1;
  const w = curva.map(p => Math.max(1, p.streamsDay));
  const total = w.reduce((s, v) => s + v, 0);
  const target = total * pct;
  let acc = 0;
  for (let i = 0; i < w.length; i++) {
    acc += w[i];
    if (acc >= target) return i + 1;
  }
  return curva.length;
}
function effectiveEcoStartDay(
  index: number, total: number, days: number,
  stored: number | undefined, modo: "simultaneo" | "sequencial",
) {
  if (stored && stored > 1) return Math.min(days, stored);
  if (total <= 1) return 1;
  const rampPct = modo === "sequencial" ? 0.7 : 0.25;
  const rampDays = Math.max(3, Math.min(days, Math.ceil(days * rampPct)));
  return Math.min(days, 1 + Math.floor((index / Math.max(1, total - 1)) * (rampDays - 1)));
}
function generatedStartDay(index: number, total: number, days: number, modo: "simultaneo" | "sequencial") {
  return effectiveEcoStartDay(index, total, days, undefined, modo);
}
function legacyStartDay(index: number, total: number, days: number) {
  if (total <= 1) return 1;
  const rampDays = Math.max(3, Math.min(days, Math.ceil(days * 0.4)));
  return Math.min(days, 1 + Math.floor((index / Math.max(1, total - 1)) * (rampDays - 1)));
}
function matchesSequence(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
function dateLabel(startedAt: string, day: number) {
  const base = new Date(startedAt);
  base.setDate(base.getDate() + day - 1);
  return base.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function isoDate(startedAt: string, day: number) {
  const base = new Date(startedAt);
  base.setDate(base.getDate() + day - 1);
  return base.toISOString().slice(0, 10);
}

// ============================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Parse token from query param or Authorization header
  const url = new URL(req.url);
  let token = (url.searchParams.get("token") ?? "").trim();
  if (!token) {
    const auth = req.headers.get("authorization") ?? "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) token = m[1].trim();
  }

  if (!token || token.length < 16 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
    return jr({
      error: "invalid_token",
      message: "Provide ?token=<public_plan_token> in query or Authorization: Bearer <token> header. Generate the token by opening 'Copiar link público' on the campaign page.",
    }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: camp, error: cErr } = await supabase
    .from("campaigns")
    .select("id, track_name, artist, cover_url, spotify_track_url, spotify_track_id, started_at, deadline, status, simulation_snapshot, engagement_multiplier, public_plan_token")
    .eq("public_plan_token", token)
    .maybeSingle();

  if (cErr) return jr({ error: cErr.message }, 500);
  if (!camp) return jr({ error: "not_found", message: "No campaign matches this token." }, 404);
  const snapshot = (camp as any).simulation_snapshot;
  if (!snapshot) return jr({ error: "no_snapshot", message: "Campaign has no frozen plan yet." }, 409);

  const { data: allocs, error: aErr } = await supabase
    .from("campaign_eco_allocations")
    .select("id, planned_streams, start_day, status, position, genre_source, managed_playlists(name, cover_url, followers, spotify_url, engagement_multiplier_override)")
    .eq("campaign_id", (camp as any).id)
    .order("planned_streams", { ascending: false });
  if (aErr) return jr({ error: aErr.message }, 500);

  const mult = Math.max(1, (camp as any).engagement_multiplier ?? 35);
  // Plano roda sobre effectiveDays (real). Snapshots antigos caem em days.
  const days = (snapshot as any).effectiveDays ?? snapshot.days;
  const startedAt = (camp as any).started_at as string;
  const modo = snapshot.modo as "simultaneo" | "sequencial";
  const ecoFloor = modo === "sequencial" ? curveThresholdDay(snapshot.curva, 0.25) : 1;
  const topPos = Number((snapshot as any)?.music?.top200Position ?? (snapshot as any)?.music?.top200Pos ?? 0) || null;
  const chartTier = chartTierFromTopPosition(topPos);

  // Preferir posições persistidas. Só recalcula dinamicamente se faltar alguma.
  const allRows = allocs ?? [];
  const allPersisted = allRows.length > 0 && allRows.every((a: any) => Number.isFinite(a.position) && a.position >= 1);
  const positions = allPersisted
    ? new Map<string, number>(allRows.map((a: any) => [a.id, a.position as number]))
    : distributeEcoPositions(
        allRows.map((a: any) => ({
          id: a.id,
          planned_streams: a.planned_streams,
          followers: Number(a.managed_playlists?.followers ?? 0),
          genreSource: (a.genre_source as "primary" | "affinity" | null) ?? "primary",
        })),
        days, mult, { chartTier },
      );

  const ordered = [...(allocs ?? [])].sort((a: any, b: any) => b.planned_streams - a.planned_streams);
  const storedStarts = ordered.map((a: any) => Number(a.start_day || 1));
  const generatedStarts = ordered.map((_: any, i: number) => generatedStartDay(i, ordered.length, days, modo));
  const legacyStarts = ordered.map((_: any, i: number) => legacyStartDay(i, ordered.length, days));
  const startsLookSystemGenerated = ordered.length > 1 && (
    storedStarts.every(s => s === 1) ||
    matchesSequence(storedStarts, generatedStarts) ||
    matchesSequence(storedStarts, legacyStarts)
  );

  const startBase = startedAt ? new Date(startedAt) : null;
  const startValid = startBase && !isNaN(startBase.getTime());

  const playlists = ordered.map((a: any, index: number) => {
    const baseStart = startsLookSystemGenerated
      ? generatedStarts[index]
      : effectiveEcoStartDay(index, ordered.length, days, a.start_day, modo);
    const startDay = Math.min(days, Math.max(baseStart, ecoFloor));
    const followers = Number(a.managed_playlists?.followers ?? 0);
    const pos = positions.get(a.id) ?? MIN_CAMPAIGN_POSITION;
    const baseCap = Math.max(1, Math.round(calculateTrackDailyStreams(followers, mult, pos)));

    const daily: number[] = Array.from({ length: days }, () => 0);
    for (let i = startDay - 1; i < days; i++) {
      const rampIdx = i - (startDay - 1);
      const ramp = rampIdx < ECO_RAMP.length ? ECO_RAMP[rampIdx] : 1;
      let weekday = 1;
      if (startValid) {
        const d = new Date(startBase!);
        d.setDate(d.getDate() + i);
        weekday = WEEKDAY_FLAT_FACTOR[d.getDay()] ?? 1;
      }
      daily[i] = Math.max(1, Math.round(baseCap * ramp * weekday));
    }
    const totalStreams = daily.reduce((s, v) => s + v, 0);

    return {
      allocation_id: a.id,
      playlist_name: a.managed_playlists?.name ?? "Playlist",
      playlist_cover_url: a.managed_playlists?.cover_url ?? null,
      playlist_spotify_url: a.managed_playlists?.spotify_url ?? null,
      followers,
      position: pos,
      cap_dia: baseCap,
      start_day: startDay,
      total_streams: totalStreams,
      status: a.status,
      daily,
    };
  });

  // Totals per day (eco only — matches the visible matrix)
  const dailyTotals = Array.from({ length: days }, (_, i) =>
    playlists.reduce((s, p) => s + (p.daily[i] ?? 0), 0),
  );
  const cumulativeTotals: number[] = [];
  let acc = 0;
  for (const v of dailyTotals) { acc += v; cumulativeTotals.push(acc); }

  const dayHeaders = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    date: isoDate(startedAt, i + 1),
    label: dateLabel(startedAt, i + 1),
  }));

  return jr({
    campaign: {
      id: (camp as any).id,
      status: (camp as any).status,
      started_at: startedAt,
      deadline: (camp as any).deadline,
      days,
      modo,
      engagement_multiplier: mult,
    },
    track: {
      name: (camp as any).track_name,
      artist: (camp as any).artist,
      cover_url: (camp as any).cover_url,
      spotify_url: (camp as any).spotify_track_url,
      spotify_id: (camp as any).spotify_track_id,
    },
    snapshot: {
      meta: snapshot.meta,
      custo_total: snapshot.custoTotal,
      custo_por_stream: snapshot.custoPorStream,
      streams_eco: snapshot.streamsEco,
      streams_ext: snapshot.streamsExt,
      split_eco_pct: snapshot.splitEcoPct,
      pico_por_dia: snapshot.picoPorDia,
      media_por_dia: snapshot.mediaPorDia,
      curva: snapshot.curva,
    },
    days: dayHeaders,
    playlists,
    totals: {
      daily: dailyTotals,
      cumulative: cumulativeTotals,
      grand_total: cumulativeTotals[cumulativeTotals.length - 1] ?? 0,
      playlists_count: playlists.length,
    },
    generated_at: new Date().toISOString(),
  });
});
