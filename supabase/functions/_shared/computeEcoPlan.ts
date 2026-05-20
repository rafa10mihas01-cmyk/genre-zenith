// Shared eco-plan compute — mirrors src/lib/campaignOperationalPlan.ts
// Used by campaign-plan-api and campaign-daily-plan edge functions.

export const POSITION_PCT: number[] = [
  0.12, 0.10, 0.08, 0.07, 0.06,
  0.05, 0.045, 0.04, 0.035, 0.03,
  0.02, 0.018, 0.016, 0.014, 0.013,
  0.012, 0.011, 0.010, 0.009, 0.008,
];
const POSITION_RESIDUAL = 0.003;
export const MIN_CAMPAIGN_POSITION = 3;
const ECO_RAMP = [0.2, 0.4, 0.6, 0.8, 1.0];
const WEEKDAY_FLAT_FACTOR = [0.92, 0.85, 1.00, 1.04, 1.06, 1.08, 1.05];

function getPositionPct(pos: number) {
  if (pos < 1) return 0;
  return POSITION_PCT[pos - 1] ?? POSITION_RESIDUAL;
}
function calcPlaylistCapacity(saves: number, mult = 30) {
  return Math.max(0, saves) * (Math.max(1, mult) / 30);
}
function calcTrackDailyStreams(saves: number, mult: number, pos: number) {
  return calcPlaylistCapacity(saves, mult) * getPositionPct(pos);
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
  const last = POSITION_BUCKETS[tier].at(-1)!;
  return [last[0], last[1]];
}
function maxViablePosition(planned: number, days: number, followers: number, mult: number) {
  if (planned <= 0 || days <= 0 || followers <= 0) return POSITION_PCT.length;
  const dailyTraffic = followers * (mult / 30);
  const dailyNeed = planned / days;
  if (dailyTraffic <= 0) return MIN_CAMPAIGN_POSITION;
  let best = MIN_CAMPAIGN_POSITION;
  for (let i = MIN_CAMPAIGN_POSITION - 1; i < POSITION_PCT.length; i++) {
    if (POSITION_PCT[i] * dailyTraffic >= dailyNeed)