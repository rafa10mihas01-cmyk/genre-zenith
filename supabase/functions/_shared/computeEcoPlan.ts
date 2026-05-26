// Shared eco-plan compute — mirrors src/lib/campaignOperationalPlan.ts.
// Single source of truth used by edge functions that need the daily matrix.

export const POSITION_PCT: number[] = [
  0.12, 0.10, 0.08, 0.07, 0.06,
  0.05, 0.045, 0.04, 0.035, 0.03,
  0.02, 0.018, 0.016, 0.014, 0.013,
  0.012, 0.011, 0.010, 0.009, 0.008,
];
const POSITION_RESIDUAL = 0.003;
export const MIN_CAMPAIGN_POSITION = 1;
const ECO_RAMP = [0.2, 0.4, 0.6, 0.8, 1.0];
const WEEKDAY_FLAT_FACTOR = [0.92, 0.85, 1.00, 1.04, 1.06, 1.08, 1.05];

function getPositionPct(pos: number) {
  if (pos < 1) return 0;
  return POSITION_PCT[pos - 1] ?? POSITION_RESIDUAL;
}
function calcTrackDailyStreams(saves: number, mult: number, pos: number) {
  return Math.max(0, saves) * (Math.max(1, mult) / 30) * getPositionPct(pos);
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
function classify(f: number): Tier {
  if (f >= 50000) return "large";
  if (f >= 10000) return "medium";
  return "small";
}
const POSITION_BUCKETS: Record<Tier, Array<[number, number, number]>> = {
  large:  [[1, 2, 0.40], [3, 5, 0.40], [6, 10, 0.20]],
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
export type CoverageMode = "normal" | "optimized" | "maximum";
export function selectCoverageMode(coverageRatio?: number): CoverageMode {
  if (!Number.isFinite(coverageRatio as number)) return "normal";
  const r = coverageRatio as number;
  if (r >= 0.8) return "normal";
  if (r >= 0.5) return "optimized";
  return "maximum";
}
const PRIMARY_RANGES_BY_MODE: Partial<Record<CoverageMode, Record<Tier, [number, number]>>> = {
  optimized: { large: [1, 3], medium: [2, 5], small: [3, 7] },
  maximum:   { large: [1, 2], medium: [1, 3], small: [2, 4] },
};
export const AFFINITY_RANGE_BY_MODE: Record<CoverageMode, [number, number]> = {
  normal:    [5, 10],
  optimized: [5, 10],
  maximum:   [3, 5],
};

/** Tier do chart Top200 (música): top50 = mais agressivo; outside = rank-based. */
export type ChartTier = "top50" | "top100" | "outside";

export function chartTierFromTopPosition(top?: number | null): ChartTier {
  const p = Number(top ?? 0);
  if (p > 0 && p <= 50) return "top50";
  if (p > 50 && p <= 100) return "top100";
  return "outside";
}

const PRIMARY_RANGES_BY_CHART: Record<ChartTier, Record<Tier, [number, number]>> = {
  top50:   { large: [1, 1], medium: [1, 1], small: [1, 1] },
  top100:  { large: [1, 2], medium: [2, 4], small: [3, 5] },
  outside: { large: [1, 1], medium: [1, 1], small: [1, 1] }, // ignorado — usa rank-based
};
const NEIGHBOR_RANGE_BY_CHART: Record<ChartTier, [number, number]> = {
  top50:   [4, 5],
  top100:  [5, 7],
  outside: [7, 10],
};

function distributeByChartTier(
  allocs: Array<{ id: string; followers: number; genreSource?: "primary" | "affinity" }>,
  chartTier: ChartTier,
): Map<string, number> {
  const out = new Map<string, number>();
  const primary = allocs.filter(a => (a.genreSource ?? "primary") === "primary")
    .sort((a, b) => b.followers - a.followers);
  const affinity = allocs.filter(a => a.genreSource === "affinity")
    .sort((a, b) => b.followers - a.followers);

  // PRIMÁRIAS
  if (chartTier === "outside") {
    const N = Math.max(1, primary.length);
    primary.forEach((a, i) => {
      const pos = Math.max(1, Math.min(20, Math.round(((i + 1) / N) * 20)));
      out.set(a.id, pos);
    });
  } else {
    const byTier: Record<Tier, typeof primary> = { large: [], medium: [], small: [] };
    for (const a of primary) byTier[classify(a.followers)].push(a);
    for (const t of ["large", "medium", "small"] as Tier[]) {
      const list = byTier[t];
      const [lo, hi] = PRIMARY_RANGES_BY_CHART[chartTier][t];
      list.forEach((a, idx) => {
        const pct = list.length <= 1 ? 0 : idx / (list.length - 1);
        out.set(a.id, lo + Math.round(pct * (hi - lo)));
      });
    }
  }

  // VIZINHOS (afinidade)
  const [nlo, nhi] = NEIGHBOR_RANGE_BY_CHART[chartTier];
  affinity.forEach((a, idx) => {
    const pct = affinity.length <= 1 ? 0 : idx / (affinity.length - 1);
    out.set(a.id, nlo + Math.round(pct * (nhi - nlo)));
  });

  return out;
}

export function distributeEcoPositions(
  allocs: Array<{ id: string; planned_streams: number; followers: number; genreSource?: "primary" | "affinity" }>,
  days: number, mult = 30,
  opts: { coverageRatio?: number; mode?: CoverageMode; chartTier?: ChartTier } = {},
): Map<string, number> {
  // Modo determinístico baseado na posição da música no Top200.
  if (opts.chartTier) return distributeByChartTier(allocs, opts.chartTier);

  const mode: CoverageMode = opts.mode ?? selectCoverageMode(opts.coverageRatio);
  const cap = 0.4;
  const total = allocs.length;
  const maxStrong = mode === "maximum" ? Infinity : Math.max(1, Math.floor(total * cap));
  const ordered = [...allocs].sort((a, b) => b.followers - a.followers);
  const out = new Map<string, number>();
  const fixedRanges = PRIMARY_RANGES_BY_MODE[mode];
  let strong = 0;
  for (const a of ordered) {
    const tier = classify(a.followers);
    const rng = seededRng(`pos:${a.id}`);
    let lo: number;
    let hi: number;
    if (fixedRanges) {
      [lo, hi] = fixedRanges[tier];
    } else {
      [lo, hi] = pickBucket(rng, tier);
      if (lo <= 5 && strong >= maxStrong) {
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
    }
    const candidate = lo + Math.floor(rng() * (hi - lo + 1));
    const viable = maxViablePosition(a.planned_streams, days, a.followers, mult);
    const pos = Math.max(MIN_CAMPAIGN_POSITION, Math.min(candidate, viable));
    if (pos <= 5) strong++;
    out.set(a.id, pos);
  }
  return out;
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
function effectiveStart(
  index: number, total: number, days: number,
  stored: number | undefined, modo: "simultaneo" | "sequencial",
) {
  if (stored && stored > 1) return Math.min(days, stored);
  if (total <= 1) return 1;
  const rampPct = modo === "sequencial" ? 0.7 : 0.25;
  const rampDays = Math.max(3, Math.min(days, Math.ceil(days * rampPct)));
  return Math.min(days, 1 + Math.floor((index / Math.max(1, total - 1)) * (rampDays - 1)));
}
function generatedStart(i: number, total: number, days: number, modo: "simultaneo" | "sequencial") {
  return effectiveStart(i, total, days, undefined, modo);
}
function legacyStart(i: number, total: number, days: number) {
  if (total <= 1) return 1;
  const rampDays = Math.max(3, Math.min(days, Math.ceil(days * 0.4)));
  return Math.min(days, 1 + Math.floor((i / Math.max(1, total - 1)) * (rampDays - 1)));
}
function sameSeq(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export type Alloc = {
  id: string;
  planned_streams: number;
  start_day: number;
  status?: string;
  position?: number | null;
  managed_playlists?: {
    id?: string;
    name?: string;
    cover_url?: string | null;
    followers?: number;
    spotify_url?: string | null;
  } | null;
};

export type EcoPlanRow = {
  allocation_id: string;
  playlist_id: string | null;
  playlist_name: string;
  playlist_cover_url: string | null;
  playlist_url: string | null;
  followers: number;
  position: number;
  cap_dia: number;
  start_day: number;
  total_streams: number;
  status: string | null;
  daily: number[];
};

export function isoDate(startedAt: string, day: number) {
  const base = new Date(startedAt);
  base.setDate(base.getDate() + day - 1);
  return base.toISOString().slice(0, 10);
}

export function dayLabel(startedAt: string, day: number) {
  const base = new Date(startedAt);
  base.setDate(base.getDate() + day - 1);
  return base.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function buildEcoPlan(args: {
  snapshot: { days: number; effectiveDays?: number; modo: "simultaneo" | "sequencial"; curva: Array<{ streamsDay: number }> };
  startedAt: string;
  engagementMultiplier: number;
  allocs: Alloc[];
}): EcoPlanRow[] {
  const { snapshot, startedAt, engagementMultiplier: mult, allocs } = args;
  // Plano roda sobre a duração REAL (effectiveDays). Snapshots antigos usam days.
  const days = snapshot.effectiveDays ?? snapshot.days;
  const modo = snapshot.modo;
  const ecoFloor = modo === "sequencial" ? curveThresholdDay(snapshot.curva, 0.25) : 1;

  // Preferir posições persistidas em campaign_eco_allocations.position.
  const allPersisted = allocs.length > 0 && allocs.every(a => Number.isFinite(a.position as number) && (a.position as number) >= 1);
  const positions = allPersisted
    ? new Map<string, number>(allocs.map(a => [a.id, a.position as number]))
    : distributeEcoPositions(
        allocs.map(a => ({
          id: a.id,
          planned_streams: a.planned_streams,
          followers: Number(a.managed_playlists?.followers ?? 0),
        })),
        days, mult,
      );

  const ordered = [...allocs].sort((a, b) => b.planned_streams - a.planned_streams);
  const stored = ordered.map(a => Number(a.start_day || 1));
  const gen = ordered.map((_, i) => generatedStart(i, ordered.length, days, modo));
  const legacy = ordered.map((_, i) => legacyStart(i, ordered.length, days));
  const startsLookGenerated = ordered.length > 1 && (
    stored.every(s => s === 1) || sameSeq(stored, gen) || sameSeq(stored, legacy)
  );

  const startBase = startedAt ? new Date(startedAt) : null;
  const startValid = !!startBase && !isNaN(startBase.getTime());

  return ordered.map((a, index) => {
    const baseStart = startsLookGenerated
      ? gen[index]
      : effectiveStart(index, ordered.length, days, a.start_day, modo);
    const startDay = Math.min(days, Math.max(baseStart, ecoFloor));
    const followers = Number(a.managed_playlists?.followers ?? 0);
    const pos = positions.get(a.id) ?? MIN_CAMPAIGN_POSITION;
    const baseCap = Math.max(1, Math.round(calcTrackDailyStreams(followers, mult, pos)));

    const daily: number[] = Array.from({ length: days }, () => 0);
    // Rampa de saída: últimos 20% dos dias decaem suavemente, espelhando a rampa de entrada.
    // tailFactor = 1 − 0.5 × ((day − tailStart) / tailDays)^2  (0.5 no último dia).
    const runLen = Math.max(1, days - (startDay - 1));
    const tailDays = Math.max(1, Math.round(runLen * 0.2));
    const tailStart = days - tailDays + 1;
    for (let i = startDay - 1; i < days; i++) {
      const rampIdx = i - (startDay - 1);
      const ramp = rampIdx < ECO_RAMP.length ? ECO_RAMP[rampIdx] : 1;
      let weekday = 1;
      if (startValid) {
        const d = new Date(startBase!);
        d.setDate(d.getDate() + i);
        weekday = WEEKDAY_FLAT_FACTOR[d.getDay()] ?? 1;
      }
      const dayNum = i + 1;
      let tail = 1;
      if (dayNum >= tailStart) {
        const t = (dayNum - tailStart) / tailDays;
        tail = 1 - 0.5 * t * t;
      }
      daily[i] = Math.max(1, Math.round(baseCap * ramp * tail * weekday));
    }
    const total = daily.reduce((s, v) => s + v, 0);

    return {
      allocation_id: a.id,
      playlist_id: (a.managed_playlists as any)?.id ?? null,
      playlist_name: a.managed_playlists?.name ?? "Playlist",
      playlist_cover_url: a.managed_playlists?.cover_url ?? null,
      playlist_url: a.managed_playlists?.spotify_url ?? null,
      followers,
      position: pos,
      cap_dia: baseCap,
      start_day: startDay,
      total_streams: total,
      status: a.status ?? null,
      daily,
    };
  });
}
