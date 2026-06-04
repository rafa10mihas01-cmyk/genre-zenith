import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { buildDailyPlateau } from "@/lib/playlistGrowthEngine";

/** Duração REAL do plano. effectiveDays quando disponível, senão days (snapshots antigos). */
function planDaysOf(snapshot: CampaignSnapshot): number {
  return Math.max(1, snapshot.effectiveDays ?? snapshot.days);
}

export type EcoPlanInput = {
  id: string;
  planned_streams: number;
  start_day: number;
  /** Posição persistida em campaign_eco_allocations.position. Null = ainda não materializada → cai no fallback dinâmico. */
  position?: number | null;
  managed_playlists?: { name: string; followers: number; cover_url?: string | null } | null;
};

export type ExternalPlanInput = {
  id: string;
  assigned_streams: number;
  assigned_cost: number;
  cost_per_stream: number;
  curators?: { name: string; contact: string | null } | null;
};

export type DailyPlaylistPlan = {
  allocationId: string;
  playlistName: string;
  coverUrl: string | null;
  followers: number;
  startDay: number;
  totalStreams: number;
  daily: number[];
  capDia: number;
  overflow: number;
  /**
   * Posição planejada por dia (1-indexed por dia do plano, length = effectiveDays).
   * Durante o platô = posição fixa. Durante a saída (últimos 20% dos dias) rebaixa
   * em 4 degraus: pos → pos×2 → pos×5 → pos×15 → pos×30 (cap 100).
   * Cells antes do startDay também ficam = posição base (facilita exibição).
   */
  positionByDay: number[];
};

/** Degrau de rebaixamento na fase de saída suave. Multiplicador aplicado sobre a posição-base. */
export function tailPositionMultiplier(t: number): number {
  if (t < 0.25) return 1;
  if (t < 0.5) return 2;
  if (t < 0.75) return 5;
  if (t < 1) return 15;
  return 30;
}

/** Posição rebaixada da música no dia (1..100). dayNum/tailStart/tailDays 1-indexed. */
export function positionForDay(basePos: number, dayNum: number, tailStart: number, tailDays: number): number {
  if (dayNum < tailStart) return basePos;
  const denom = Math.max(1, tailDays - 1);
  const t = (dayNum - tailStart) / denom;
  const mult = tailPositionMultiplier(t);
  return Math.min(100, Math.max(1, basePos * mult));
}

export type DailyExternalPlan = {
  itemId: string;
  curatorName: string;
  contact: string | null;
  startDay: number;
  totalStreams: number;
  totalCost: number;
  costPerStream: number;
  daily: number[];
};

export type DailyCampaignPlan = {
  day: number;
  dateLabel: string;
  total: number;
  eco: number;
  external: number;
  cumulative: number;
  activePlaylists: number;
  activeCurators: number;
};

/** Atraso médio de contabilização do Spotify (em dias). */
export const REPORTING_DELAY_DAYS = 2;
/** Ramp de entrada de playlist eco nos primeiros dias — agora curto (3 dias). */
export const ECO_RAMP = [0.6, 0.85, 1.0];

/**
 * Boost algorítmico após a rampa: a faixa fica fixa na posição e o Spotify
 * começa a recomendar mais quando engaja. Padrão compounding +5% / -3%
 * (alternado) aplicado por dia, com teto pra não estourar.
 */
export const ECO_GROWTH_CAP = 1.25;
export function ecoGrowthFactor(daysSinceSteady: number): number {
  if (daysSinceSteady < 0) return 1;
  let f = 1;
  for (let i = 0; i <= daysSinceSteady; i++) {
    f *= i % 2 === 0 ? 1.05 : 0.97;
    if (f >= ECO_GROWTH_CAP) return ECO_GROWTH_CAP;
  }
  return f;
}
/** Soma teórica do multiplicador de plano (rampa + growth, sem weekday/tail). */
export function ecoPlanTotalMultiplier(days: number): number {
  let total = 0;
  for (let i = 0; i < days; i++) {
    const ramp = i < ECO_RAMP.length ? ECO_RAMP[i] : 1;
    const growthIdx = i - ECO_RAMP.length;
    const growth = growthIdx >= 0 ? ecoGrowthFactor(growthIdx) : 1;
    total += ramp * growth;
  }
  return total;
}

/**
 * VERDADE ÚNICA do sistema — curva de tráfego por posição na playlist.
 * Index 0 = posição 1. % do tráfego diário total da playlist (saves × mult/30).
 * Mesma curva do SimuladorEntrega → simulador, campanha, cards e relatórios
 * usam esta tabela. Não criar fatores alternativos (ex.: ECO_CAPACITY_FACTOR).
 */
export const POSITION_PCT: number[] = [
  0.12, 0.10, 0.08, 0.07, 0.06,
  0.05, 0.045, 0.04, 0.035, 0.03,
  0.02, 0.018, 0.016, 0.014, 0.013,
  0.012, 0.011, 0.010, 0.009, 0.008,
];
const POSITION_RESIDUAL = 0.003;

/** % de tráfego para a posição `pos` (1-indexed). Cauda além de 20 = residual. */
export function getPositionPct(pos: number): number {
  if (pos < 1) return 0;
  const idx = pos - 1;
  return POSITION_PCT[idx] ?? POSITION_RESIDUAL;
}

/**
 * Capacidade diária TOTAL da playlist = saves × (mult/30).
 * É o teto absoluto somando orgânicas + campanhas + fixas naquele dia.
 */
export function calculatePlaylistCapacity(saves: number, multiplier = 30): number {
  return Math.max(0, saves) * (Math.max(1, multiplier) / 30);
}

/**
 * Plays/dia REAIS de uma faixa numa posição = saves × (mult/30) × POSITION_PCT[pos].
 * Verdade matemática que alimenta simulador, campanha, UI e relatórios.
 */
export function calculateTrackDailyStreams(
  saves: number,
  multiplier: number,
  assignedPosition: number,
): number {
  return calculatePlaylistCapacity(saves, multiplier) * getPositionPct(assignedPosition);
}

/**
 * Tolerância padrão de "estouro" aceito por playlist na seleção por
 * capacidade real. 0.10 = aceita entregar até 10% acima do daily_need.
 * Espelha ECO_DAILY_TOLERANCE em _shared/computeEcoPlan.ts.
 */
export const ECO_DAILY_TOLERANCE = 0.10;

/**
 * Para uma playlist, escolhe a posição com MAIOR cap_dia que NÃO ultrapasse
 * `dailyNeed × (1 + tolerance)`. Espelha selectPositionByDailyNeed da edge.
 *
 * - Se nenhuma posição cabe (playlist gigante), devolve a mais profunda (cap mínimo).
 * - Se a playlist é pequena demais, devolve a posição #1 (cobre o que conseguir).
 */
export function selectPositionByDailyNeed(
  followers: number,
  multiplier: number,
  dailyNeed: number,
  tolerance = ECO_DAILY_TOLERANCE,
  minPosition = 1,
): { position: number; cap: number; fits: boolean } {
  if (followers <= 0 || dailyNeed <= 0) {
    return { position: Math.max(1, minPosition), cap: 0, fits: false };
  }
  const ceiling = dailyNeed * (1 + tolerance);
  const startIdx = Math.max(0, minPosition - 1);
  let bestPos = -1;
  let bestCap = -1;
  for (let i = startIdx; i < POSITION_PCT.length; i++) {
    const cap = calculateTrackDailyStreams(followers, multiplier, i + 1);
    if (cap <= ceiling && cap > bestCap) {
      bestCap = cap;
      bestPos = i + 1;
    }
  }
  if (bestPos > 0) return { position: bestPos, cap: bestCap, fits: bestCap > 0 };
  const deepest = POSITION_PCT.length;
  return {
    position: deepest,
    cap: calculateTrackDailyStreams(followers, multiplier, deepest),
    fits: false,
  };
}

/**
 * Posição mínima para playlists VIZINHAS (gênero por afinidade).
 * Vizinhos nunca entram nos slots fortes (1–4) — vão de 5 pra baixo, mesma
 * regra do `replan-campaign-eco`. Mantém a "cara" de campanha de gênero.
 */
export const NEIGHBOR_MIN_POSITION = 5;

/**
 * Piso mínimo de saves pra uma playlist entrar no planner de campanha.
 * Espelha `supabase/functions/_shared/eco-constants.ts`.
 * Abaixo de 250 saves a contribuição vira ruído (<20 plays/dia em pos #3)
 * e polui o plano sem entregar.
 */
export const MIN_PLAYLIST_SAVES_FOR_CAMPAIGN = 250;

/**
 * Piso de entrega POR PLAYLIST POR DIA ATIVO. Espelha
 * `supabase/functions/_shared/eco-constants.ts`.
 * Toda playlist participante deve entregar ≥ piso em todo dia ativo
 * (incluindo rampa e tail). Promoção automática de posição quando a posição
 * planejada não atende; expulsão upstream quando nem pos #1 atende.
 */
export const MIN_PLAYLIST_DAILY_STREAMS = 500;

/** Posição mais profunda cuja cap ainda atende o piso. Null se nem pos #1 atende. */
export function deepestPositionMeetingFloor(
  followers: number,
  multiplier: number,
  floor: number = MIN_PLAYLIST_DAILY_STREAMS,
): number | null {
  if (followers <= 0) return null;
  let deepest: number | null = null;
  for (let i = 0; i < POSITION_PCT.length; i++) {
    const cap = calculateTrackDailyStreams(followers, multiplier, i + 1);
    if (cap >= floor) deepest = i + 1;
  }
  return deepest;
}

/**
 * Aplica o piso à curva diária preservando o total exato. Eleva dias < piso
 * pro piso e retira o excesso dos dias acima do piso, proporcional ao excedente.
 */
export function applyPlaylistDailyFloor(
  daily: number[],
  floor: number = MIN_PLAYLIST_DAILY_STREAMS,
): number[] {
  if (!daily.length) return daily;
  const originalTotal = daily.reduce((s, v) => s + v, 0);
  const out = daily.slice();
  for (let i = 0; i < out.length; i++) {
    if (out[i] > 0 && out[i] < floor) out[i] = floor;
  }
  let excess = out.reduce((s, v) => s + v, 0) - originalTotal;
  if (excess <= 0) return out;
  let guard = out.length * 100;
  while (excess > 0 && guard-- > 0) {
    let headroom = 0;
    for (const v of out) if (v > floor) headroom += v - floor;
    if (headroom <= 0) break;
    let removed = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i] <= floor) continue;
      const share = (out[i] - floor) / headroom;
      const take = Math.min(out[i] - floor, Math.max(1, Math.round(excess * share)));
      out[i] -= take;
      removed += take;
      if (removed >= excess) break;
    }
    if (removed === 0) break;
    excess -= removed;
  }
  return out;
}

/**
 * Fator de compensação da curva de entrega.
 * A simulação dia-a-dia (ECO_RAMP + tail de saída com rebaixamento de
 * posição) consome ~12% do total teórico. Pra GARANTIR a entrega da meta
 * contratada, o planner mira capacidade teórica = meta × este fator. Assim,
 * depois da curva, a entrega real bate na meta.
 *
 * Empírico: 1 / (1 - 0.12) ≈ 1.136 → arredondamos pra 1.15 (3% de margem).
 * Espelha `supabase/functions/_shared/eco-constants.ts`.
 */
export const ECO_CURVE_LOSS_COMPENSATION = 1.15;

/**
 * Distribui posições greedy por dailyNeed sobre uma lista de playlists.
 *
 * SELEÇÃO BEST-FIT (eficiência marginal): a cada iteração, escolhe a playlist
 * cujo melhor cap mais se aproxima de fechar a necessidade restante sem
 * estourar. Primárias antes de vizinhos. Para quando cobre o dailyNeed.
 *
 * Fórmula de cap (saves × mult/30 × %posição) NÃO MUDA — só a ordem.
 */
export interface RealCapacityAlloc {
  id: string;
  name?: string;
  followers: number;
  source: "primary" | "neighbor";
  position: number;
  cap_dia: number;
  fits: boolean;
}

export type RealCapacityMode = "cascade" | "balanced";

export function planRealCapacity(
  playlists: Array<{ id: string; name?: string; followers: number; source: "primary" | "neighbor" }>,
  dailyNeed: number,
  multiplier: number,
  tolerance = ECO_DAILY_TOLERANCE,
  opts: { mode?: RealCapacityMode } = {},
): { allocations: RealCapacityAlloc[]; coveredDaily: number; remaining: number } {
  if (dailyNeed <= 0 || playlists.length === 0) {
    return { allocations: [], coveredDaily: 0, remaining: dailyNeed };
  }
  const mode: RealCapacityMode = opts.mode ?? "cascade";
  const primary = playlists.filter(p => p.source === "primary");
  const neighbor = playlists.filter(p => p.source === "neighbor");
  const allocations: RealCapacityAlloc[] = [];

  // Compensa a perda da curva (rampa entrada + tail saída). A entrega real
  // dia-a-dia consome ~12% do total teórico — miramos capacidade maior pra
  // que, depois da curva, a entrega bata na meta contratada.
  const targetDaily = dailyNeed * ECO_CURVE_LOSS_COMPENSATION;
  let remaining = targetDaily;
  let covered = 0;

  // Early-stop: para de adicionar quando cobriu ≥95% da meta diária (já compensada).
  const COVERAGE_STOP = 0.95;
  const stopThreshold = targetDaily * (1 - COVERAGE_STOP);

  // Modo balanced (gravadora/label): segura primárias em ~70% da meta pra abrir
  // espaço pra ~30% de vizinhos. Reduz total de playlists usando peso alto dos
  // vizinhos em posições 5+, sem inchar a contagem.
  const PRIMARY_BALANCED_SHARE = 0.70;
  const primaryStopThreshold =
    mode === "balanced" ? targetDaily * (1 - PRIMARY_BALANCED_SHARE) : stopThreshold;

  const consume = (list: typeof primary, minPos: number, stopAt: number) => {
    const pool = [...list];
    while (pool.length > 0 && remaining > stopAt) {
      let bestIdx = -1;
      let bestSel: { position: number; cap: number; fits: boolean } | null = null;
      for (let i = 0; i < pool.length; i++) {
        const sel = selectPositionByDailyNeed(pool[i].followers, multiplier, remaining, tolerance, minPos);
        if (sel.cap <= 0) continue;
        if (bestSel == null || sel.cap > bestSel.cap) {
          bestSel = sel;
          bestIdx = i;
        }
      }
      if (bestIdx < 0 || bestSel == null) break;
      const p = pool.splice(bestIdx, 1)[0];
      allocations.push({
        id: p.id,
        name: p.name,
        followers: p.followers,
        source: p.source,
        position: bestSel.position,
        cap_dia: bestSel.cap,
        fits: bestSel.fits,
      });
      covered += bestSel.cap;
      remaining -= bestSel.cap;
    }
  };

  if (mode === "balanced") {
    // 1) Primárias até 70% da meta (posições livres 1–20).
    consume(primary, 1, primaryStopThreshold);
    // 2) Vizinhos pra fechar o gap até 95% (posições 5+).
    if (remaining > stopThreshold) consume(neighbor, NEIGHBOR_MIN_POSITION, stopThreshold);
    // 3) Fallback: se vizinhos esgotaram antes do 95%, volta pra primárias.
    if (remaining > stopThreshold) consume(primary, 1, stopThreshold);
  } else {
    // Cascata padrão: primárias livres, vizinhos só pra fechar gap em pos ≥5.
    consume(primary, 1, stopThreshold);
    if (remaining > stopThreshold) consume(neighbor, NEIGHBOR_MIN_POSITION, stopThreshold);
  }

  return { allocations, coveredDaily: covered, remaining: Math.max(0, remaining) };
}


/**
 * Capacidade restante num slot considerando ocupação atual (lista de faixas
 * concorrentes naquela posição). Cada faixa "consome" o pct daquela posição
 * uma vez; mais de uma faixa no mesmo slot divide o pct entre elas.
 */
export function getRemainingSlotCapacity(
  saves: number,
  multiplier: number,
  position: number,
  occupiedTracks = 0,
): number {
  const slotTotal = calculateTrackDailyStreams(saves, multiplier, position);
  return Math.max(0, slotTotal - slotTotal * Math.min(1, occupiedTracks));
}

/** Valida se uma faixa cabe na posição pedida (capacidade do slot ≥ demanda). */
export function canAllocateTrackToPosition(
  saves: number,
  multiplier: number,
  position: number,
  requestedDailyStreams: number,
  occupiedTracks = 0,
): boolean {
  return getRemainingSlotCapacity(saves, multiplier, position, occupiedTracks) >= requestedDailyStreams;
}

/**
 * Posições 1 e 2 são reservadas pras faixas orgânicas que trazem engajamento
 * pra própria playlist — campanha nunca entra nelas (anti-spam Spotify).
 */
export const MIN_CAMPAIGN_POSITION = 1;

export function getCampaignPreferredPositions(snapshot?: CampaignSnapshot | null): number[] {
  const music = snapshot?.music as (CampaignSnapshot["music"] & {
    top200Position?: number | null;
    top200Pos?: number | null;
  }) | undefined;
  const topPosition = Number(music?.top200Position ?? music?.top200Pos ?? 0);
  return Number.isFinite(topPosition) && topPosition > 0 && topPosition <= 50
    ? [1, 2, 3]
    : [MIN_CAMPAIGN_POSITION];
}

export function inferEcoPreferredPositions(
  snapshot: CampaignSnapshot,
  allocs: EcoPositionInput[],
  engagementMultiplier = 30,
): number[] {
  const saved = getCampaignPreferredPositions(snapshot);
  if (saved.some((p) => p < MIN_CAMPAIGN_POSITION)) return saved;
  const neededPerDay = allocs.reduce((sum, a) => sum + Math.max(0, a.planned_streams || 0), 0) / Math.max(1, planDaysOf(snapshot));
  const baseSlotThree = allocs.reduce(
    (sum, a) => sum + calculateTrackDailyStreams(a.followers, engagementMultiplier, MIN_CAMPAIGN_POSITION),
    0,
  );
  return neededPerDay > baseSlotThree * 1.02 ? [1, 2, 3] : saved;
}

/**
 * @deprecated Removido — agora a capacidade é derivada de POSITION_PCT.
 * Mantido apenas para compatibilidade de import; não usar em novas chamadas.
 */
export const ECO_CAPACITY_FACTOR = 0;

/** PRNG determinístico (mulberry32) a partir de uma seed string. */
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

export type PlaylistSizeTier = "large" | "medium" | "small";
export function classifyPlaylistSize(followers: number): PlaylistSizeTier {
  if (followers >= 50000) return "large";
  if (followers >= 10000) return "medium";
  return "small";
}

/**
 * Buckets probabilísticos por tier: [slotMin, slotMax, prob].
 * Grandes preferem slots fortes (#3-5), pequenas preferem cauda.
 */
const POSITION_BUCKETS: Record<PlaylistSizeTier, Array<[number, number, number]>> = {
  large:  [[1, 2, 0.40], [3, 5, 0.40], [6, 10, 0.20]],
  medium: [[3, 5, 0.20], [6, 10, 0.60], [11, 15, 0.20]],
  small:  [[3, 5, 0.10], [6, 10, 0.30], [11, 20, 0.60]],
};

function pickBucket(rng: () => number, tier: PlaylistSizeTier): [number, number] {
  const r = rng();
  let acc = 0;
  for (const [lo, hi, p] of POSITION_BUCKETS[tier]) {
    acc += p;
    if (r <= acc) return [lo, hi];
  }
  const last = POSITION_BUCKETS[tier][POSITION_BUCKETS[tier].length - 1];
  return [last[0], last[1]];
}

/**
 * Posição MAIS FRACA (maior número) que ainda comporta a demanda diária.
 * Lower number = slot mais forte = MAIS capacidade. Então qualquer pos ≤ este
 * número também entrega. Usado como teto para o sorteio probabilístico:
 * se o candidato sorteado for mais fraco que isso, sobe pra cá.
 */
function maxViablePosition(
  plannedStreams: number,
  days: number,
  followers: number,
  engagementMultiplier: number,
): number {
  if (plannedStreams <= 0 || days <= 0 || followers <= 0) return POSITION_PCT.length;
  const dailyTraffic = followers * (engagementMultiplier / 30);
  const dailyNeed = plannedStreams / days;
  if (dailyTraffic <= 0) return MIN_CAMPAIGN_POSITION;
  let best = MIN_CAMPAIGN_POSITION;
  for (let i = MIN_CAMPAIGN_POSITION - 1; i < POSITION_PCT.length; i++) {
    if (POSITION_PCT[i] * dailyTraffic >= dailyNeed) best = i + 1;
  }
  return best;
}

/**
 * Posição recomendada para UMA playlist via distribuição probabilística por tier.
 * Para evitar padrão repetitivo entre playlists, prefira `distributeEcoPositions`,
 * que aplica anti-saturação no lote inteiro.
 */
export function recommendEcoPosition(
  plannedStreams: number,
  days: number,
  followers: number,
  engagementMultiplier = 30,
  seed = "default",
): number {
  const tier = classifyPlaylistSize(followers);
  const rng = seededRng(`${seed}:${followers}:${plannedStreams}`);
  const [lo, hi] = pickBucket(rng, tier);
  const candidate = lo + Math.floor(rng() * (hi - lo + 1));
  const viable = maxViablePosition(plannedStreams, days, followers, engagementMultiplier);
  return Math.max(MIN_CAMPAIGN_POSITION, Math.min(candidate, viable));
}

export type EcoPositionInput = { id: string; planned_streams: number; followers: number };

export type CoverageMode = "normal" | "optimized" | "maximum";

/** Seleciona o modo de distribuição com base na razão capacidade/meta. */
export function selectCoverageMode(coverageRatio?: number): CoverageMode {
  if (!Number.isFinite(coverageRatio as number)) return "normal";
  const r = coverageRatio as number;
  if (r >= 0.8) return "normal";
  if (r >= 0.5) return "optimized";
  return "maximum";
}

/** Faixas fixas (lo,hi) por tier para modos otimizado/máximo (primário). */
const PRIMARY_RANGES_BY_MODE: Partial<Record<CoverageMode, Record<PlaylistSizeTier, [number, number]>>> = {
  optimized: { large: [1, 3], medium: [2, 5], small: [3, 7] },
  maximum:   { large: [1, 2], medium: [1, 3], small: [2, 4] },
};

/** Faixa fixa para playlists de afinidade (vizinhos) por modo. */
export const AFFINITY_RANGE_BY_MODE: Record<CoverageMode, [number, number]> = {
  normal:    [5, 10],
  optimized: [5, 10],
  maximum:   [3, 5],
};

/**
 * Distribui posições para um lote, com anti-saturação: limita a fração de
 * faixas em slots fortes (#3-5). Determinístico (seed por id da alocação).
 *
 * Modo adaptativo: passe `coverageRatio` (capacidadeTotal/metaEco) para
 * selecionar `normal` (≥0.80, tiers atuais), `optimized` (≥0.50, faixas
 * encurtadas pra frente) ou `maximum` (<0.50, primário em slots fortes,
 * cap de slots fortes IGNORADO).
 */
/** Tier do chart Top200 da música — top50 agressivo, outside rank-based. */
export type ChartTier = "top50" | "top100" | "outside";

export function chartTierFromTopPosition(top?: number | null): ChartTier {
  const p = Number(top ?? 0);
  if (p > 0 && p <= 50) return "top50";
  if (p > 50 && p <= 100) return "top100";
  return "outside";
}

export function chartTierFromSnapshot(snapshot?: { music?: { top200Position?: number | null; top200Pos?: number | null } | null } | null): ChartTier {
  const m = snapshot?.music as any;
  return chartTierFromTopPosition(m?.top200Position ?? m?.top200Pos ?? null);
}

const PRIMARY_RANGES_BY_CHART: Record<ChartTier, Record<PlaylistSizeTier, [number, number]>> = {
  top50:   { large: [1, 1], medium: [1, 1], small: [1, 1] },
  top100:  { large: [1, 2], medium: [2, 4], small: [3, 5] },
  outside: { large: [1, 1], medium: [1, 1], small: [1, 1] }, // ignorado — usa ranking [3-7]
};
const NEIGHBOR_RANGE_BY_CHART: Record<ChartTier, [number, number]> = {
  top50:   [4, 5],
  top100:  [5, 7],
  outside: [7, 10],
};
/** Faixa de posições para primárias quando a música está fora do Top 200.
 *  Música sem chart precisa de posições FORTES pra entrar — não fracas.
 *  Range [3-7] distribui por followers (maior → posição mais forte). */
const OUTSIDE_PRIMARY_RANGE: [number, number] = [3, 7];

function distributeByChartTier(
  allocs: Array<{ id: string; followers: number; genreSource?: "primary" | "affinity" }>,
  chartTier: ChartTier,
): Map<string, number> {
  const out = new Map<string, number>();
  const primary = allocs.filter(a => (a.genreSource ?? "primary") === "primary")
    .sort((a, b) => b.followers - a.followers);
  const affinity = allocs.filter(a => a.genreSource === "affinity")
    .sort((a, b) => b.followers - a.followers);

  if (chartTier === "outside") {
    // Distribui primárias em [3-7] por followers descendente (já ordenado acima).
    // Maior playlist recebe pos mais forte (3), menor recebe a mais fraca (7).
    const [lo, hi] = OUTSIDE_PRIMARY_RANGE;
    primary.forEach((a, idx) => {
      const pct = primary.length <= 1 ? 0 : idx / (primary.length - 1);
      out.set(a.id, lo + Math.round(pct * (hi - lo)));
    });
  } else {
    const byTier: Record<PlaylistSizeTier, typeof primary> = { large: [], medium: [], small: [] };
    for (const a of primary) byTier[classifyPlaylistSize(a.followers)].push(a);
    for (const t of ["large", "medium", "small"] as PlaylistSizeTier[]) {
      const list = byTier[t];
      const [lo, hi] = PRIMARY_RANGES_BY_CHART[chartTier][t];
      list.forEach((a, idx) => {
        const pct = list.length <= 1 ? 0 : idx / (list.length - 1);
        out.set(a.id, lo + Math.round(pct * (hi - lo)));
      });
    }
  }

  const [nlo, nhi] = NEIGHBOR_RANGE_BY_CHART[chartTier];
  affinity.forEach((a, idx) => {
    const pct = affinity.length <= 1 ? 0 : idx / (affinity.length - 1);
    out.set(a.id, nlo + Math.round(pct * (nhi - nlo)));
  });

  return out;
}

export function distributeEcoPositions(
  allocs: Array<EcoPositionInput & { genreSource?: "primary" | "affinity" }>,
  days: number,
  engagementMultiplier = 30,
  opts: { strongSlotShareCap?: number; preferredSlots?: number[]; coverageRatio?: number; mode?: CoverageMode; chartTier?: ChartTier } = {},
): Map<string, number> {
  // Modo determinístico baseado na posição no Top200 — sem RNG, sem buckets.
  if (opts.chartTier) return distributeByChartTier(allocs, opts.chartTier);

  const preferredSlots = (opts.preferredSlots ?? []).filter((p) => Number.isFinite(p) && p >= 1);
  const mode: CoverageMode = opts.mode ?? selectCoverageMode(opts.coverageRatio);
  const cap = opts.strongSlotShareCap ?? 0.4;
  const total = allocs.length;
  const maxStrong = mode === "maximum" ? Infinity : Math.max(1, Math.floor(total * cap));
  const ordered = [...allocs].sort((a, b) => b.followers - a.followers);
  const result = new Map<string, number>();
  if (preferredSlots.length > 0) {
    ordered.forEach((a, index) => result.set(a.id, preferredSlots[index % preferredSlots.length] ?? MIN_CAMPAIGN_POSITION));
    return result;
  }
  const fixedRanges = PRIMARY_RANGES_BY_MODE[mode];
  let strongUsed = 0;

  for (const a of ordered) {
    const tier = classifyPlaylistSize(a.followers);
    const rng = seededRng(`pos:${a.id}`);
    let lo: number;
    let hi: number;
    if (fixedRanges) {
      [lo, hi] = fixedRanges[tier];
    } else {
      [lo, hi] = pickBucket(rng, tier);
      if (lo <= 5 && strongUsed >= maxStrong) {
        const rest = POSITION_BUCKETS[tier].filter(b => b[0] > 5);
        if (rest.length) {
          const sum = rest.reduce((s, b) => s + b[2], 0);
          const r = rng();
          let acc = 0;
          for (const [blo, bhi, p] of rest) {
            acc += p / sum;
            if (r <= acc) { lo = blo; hi = bhi; break; }
          }
        } else {
          lo = 6; hi = 10;
        }
      }
    }
    const candidate = lo + Math.floor(rng() * (hi - lo + 1));
    const viable = maxViablePosition(a.planned_streams, days, a.followers, engagementMultiplier);
    const pos = Math.max(MIN_CAMPAIGN_POSITION, Math.min(candidate, viable));
    if (pos <= 5) strongUsed++;
    result.set(a.id, pos);
  }
  return result;
}


/**
 * Sazonalidade semanal de streaming (BR/global). Multiplicadores relativos
 * à média (1.0) por dia da semana — calibrados a partir do padrão observado
 * no Spotify: pico quinta/sexta (playlist refresh + fim de semana social),
 * queda no sábado e fundo no domingo/segunda.
 * Index: 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb.
 * Soma ≈ 7.0 (preserva total semanal).
 */
// Curva semanal calibrada: base = engagement × 30 (Ter). Sex 45, Sáb 48 (pico), Seg 25 (fundo).
// [Dom, Seg, Ter, Qua, Qui, Sex, Sáb] → fator multiplicado pelo streamsDay da curva.
export const WEEKDAY_FACTOR: number[] = [1.167, 0.833, 1.000, 1.167, 1.333, 1.500, 1.600];

/**
 * Sazonalidade semanal "plana" — média ≈ 1.0, usada quando o cap diário da
 * faixa já está definido pela POSITION_PCT e a única variação esperada é o
 * dip de fim-de-semana / segunda. [Dom, Seg, Ter, Qua, Qui, Sex, Sáb].
 * Mantém a faixa estável em ~capDia e só desce um pouco Dom/Seg.
 */
export const WEEKDAY_FLAT_FACTOR: number[] = [0.92, 0.85, 1.00, 1.04, 1.06, 1.08, 1.05];

/**
 * Aplica sazonalidade semanal à curva-base: multiplica cada `streamsDay`
 * pelo fator do dia da semana correspondente e renormaliza para preservar
 * o total exato da curva original. Não muta a curva de entrada.
 */
export function applyWeekdaySeasonality(
  curva: CampaignSnapshot["curva"],
  startedAt: string,
): CampaignSnapshot["curva"] {
  if (!curva.length) return curva;
  const base = new Date(startedAt);
  if (isNaN(base.getTime())) return curva;

  const weighted = curva.map((p, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    const f = WEEKDAY_FACTOR[d.getDay()] ?? 1;
    return Math.max(0, p.streamsDay * f);
  });
  const originalSum = curva.reduce((s, p) => s + p.streamsDay, 0);
  const weightedSum = weighted.reduce((s, v) => s + v, 0);
  if (weightedSum <= 0 || originalSum <= 0) return curva;

  const scale = originalSum / weightedSum;
  let cum = 0;
  let allocated = 0;
  return weighted.map((v, i) => {
    const isLast = i === weighted.length - 1;
    const streamsDay = isLast
      ? Math.max(0, Math.round(originalSum - allocated))
      : Math.max(0, Math.round(v * scale));
    allocated += streamsDay;
    cum += streamsDay;
    const orig = curva[i];
    const ratio = orig.streamsDay > 0 ? streamsDay / orig.streamsDay : 0;
    const streamsEcoDay = Math.round((orig.streamsEcoDay ?? 0) * ratio);
    const streamsExtDay = Math.max(0, streamsDay - streamsEcoDay);
    return { day: i + 1, streamsDay, streamsEcoDay, streamsExtDay, cumulative: cum };
  });
}

function campaignDateLabel(startedAt: string, day: number) {
  const base = new Date(startedAt);
  base.setDate(base.getDate() + day - 1);
  return base.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/**
 * Distribui `total` streams ao longo da curva, começando em `startDay`.
 * Suporta:
 *  - `capDia`: teto por dia (número fixo OU array por índice de dia). Excesso cascateia.
 *  - `delay`: shift de contabilização (D1 vira D1+delay). Streams além do último dia acumulam no último.
 *
 * Retorna o vetor `daily` (length = curva.length) e `overflow` que não coube nem com cascata.
 */
function distributeByCurve(
  total: number,
  curva: CampaignSnapshot["curva"],
  startDay = 1,
  opts: { capDia?: number | number[]; delay?: number } = {},
): { daily: number[]; overflow: number } {
  const days = curva.length;
  const daily = Array.from({ length: days }, () => 0);
  if (total <= 0 || days === 0) return { daily, overflow: 0 };

  const startIndex = Math.max(0, Math.min(days - 1, startDay - 1));
  const weights = curva.slice(startIndex).map(p => Math.max(1, p.streamsDay));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  let allocated = 0;

  weights.forEach((w, i) => {
    const dayIndex = startIndex + i;
    const value = i === weights.length - 1 ? Math.max(0, total - allocated) : Math.round((w / weightSum) * total);
    daily[dayIndex] = value;
    allocated += value;
  });

  // Delay de contabilização: shift right; quem cair além do último dia acumula no último.
  const delay = Math.max(0, opts.delay ?? 0);
  if (delay > 0) {
    const shifted = Array.from({ length: days }, () => 0);
    for (let i = 0; i < days; i++) {
      if (daily[i] <= 0) continue;
      const t = Math.min(days - 1, i + delay);
      shifted[t] += daily[i];
    }
    for (let i = 0; i < days; i++) daily[i] = shifted[i];
  }

  // Cap por dia: clampar e cascatear excesso para frente.
  let overflow = 0;
  if (opts.capDia !== undefined) {
    const capArr = Array.isArray(opts.capDia)
      ? opts.capDia
      : Array.from({ length: days }, () => opts.capDia as number);
    for (let pass = 0; pass < 5; pass++) {
      let dirty = false;
      for (let i = 0; i < days; i++) {
        const c = capArr[i];
        if (c === undefined || !isFinite(c)) continue;
        if (daily[i] > c) {
          const excess = daily[i] - c;
          daily[i] = c;
          if (i + 1 < days) {
            daily[i + 1] += excess;
            dirty = true;
          } else {
            overflow += excess;
          }
        }
      }
      if (!dirty) break;
    }
  }

  return { daily, overflow };
}

export function effectiveEcoStartDay(
  index: number,
  total: number,
  days: number,
  storedStartDay?: number,
  modo: "simultaneo" | "sequencial" = "simultaneo",
) {
  if (storedStartDay && storedStartDay > 1) return Math.min(days, storedStartDay);
  if (total <= 1) return 1;
  // Simultâneo: aquece rápido (~25% dos dias). Sequencial: entra em fila (~70%).
  const rampPct = modo === "sequencial" ? 0.7 : 0.25;
  const rampDays = Math.max(3, Math.min(days, Math.ceil(days * rampPct)));
  return Math.min(days, 1 + Math.floor((index / Math.max(1, total - 1)) * (rampDays - 1)));
}

function generatedStartDay(index: number, total: number, days: number, modo: CampaignSnapshot["modo"]) {
  return effectiveEcoStartDay(index, total, days, undefined, modo);
}

function legacyStartDay(index: number, total: number, days: number) {
  if (total <= 1) return 1;
  const rampDays = Math.max(3, Math.min(days, Math.ceil(days * 0.4)));
  return Math.min(days, 1 + Math.floor((index / Math.max(1, total - 1)) * (rampDays - 1)));
}

function matchesSequence(values: number[], expected: number[]) {
  return values.length === expected.length && values.every((v, i) => v === expected[i]);
}

/**
 * No modo sequencial, o ecossistema próprio só entra depois que o externo
 * aquece a faixa. Calcula o dia em que a curva acumulada atinge `pct` do total —
 * funciona como proxy do momento em que o externo cumpre ~25% da meta.
 */
export function curveThresholdDay(curva: CampaignSnapshot["curva"], pct: number) {
  if (!curva.length) return 1;
  const weights = curva.map(p => Math.max(1, p.streamsDay));
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const target = totalWeight * pct;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (acc >= target) return i + 1;
  }
  return curva.length;
}

/** Exposto para o componente: total não absorvido pelo inventário eco (último build). */
export type EcoPlanResult = DailyPlaylistPlan[] & { unmetEco?: number };

/** Hash determinístico (FNV-1a 32 bits) sobre string → número estável entre renders. */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Aplica variação natural (±15%) por dia, mantendo o total exato e respeitando o cap.
 * Determinístico via seed (allocationId) → não muda entre renders.
 * Playlist real nunca entrega o mesmo número todo dia: tem dia melhor, dia pior.
 */
function applyDailyJitter(daily: number[], capPerDay: number, seed: string) {
  const activeIdx: number[] = [];
  for (let i = 0; i < daily.length; i++) if (daily[i] > 0) activeIdx.push(i);
  if (activeIdx.length < 2) return;

  const originalSum = daily.reduce((s, v) => s + v, 0);

  // 1) Reescala cada dia ativo por fator 0.78..1.22 (variação natural ~±22%).
  for (const i of activeIdx) {
    const r = (hashStr(`${seed}:${i}`) % 10000) / 10000; // 0..1
    const factor = 0.78 + r * 0.44; // 0.78..1.22
    const nv = Math.max(1, Math.min(capPerDay, Math.round(daily[i] * factor)));
    daily[i] = nv;
  }

  // 2) Reequilibra para preservar a soma original, respeitando cap e mínimo 1.
  let delta = originalSum - daily.reduce((s, v) => s + v, 0);
  let guard = activeIdx.length * 40;
  let cursor = 0;
  while (delta !== 0 && guard-- > 0) {
    const idx = activeIdx[cursor % activeIdx.length];
    cursor++;
    if (delta > 0) {
      if (daily[idx] < capPerDay) { daily[idx]++; delta--; }
    } else {
      if (daily[idx] > 1) { daily[idx]--; delta++; }
    }
  }
}

export function buildEcoPlaylistPlan(
  snapshot: CampaignSnapshot,
  allocs: EcoPlanInput[],
  opts: {
    engagementMultiplier?: number;
    startedAt?: string;
    /** Mapa allocId → posição final (1-indexed). Se ausente, deriva via distributeEcoPositions. */
    positions?: Map<string, number>;
  } = {},
): EcoPlanResult {
  // Multiplicador plays/save/mês — propagado da campanha. Fórmula oficial:
  //   trackDailyStreams = saves × (mult/30) × POSITION_PCT[pos]
  const multiplier = Math.max(1, opts.engagementMultiplier ?? 30);
  const curva = opts.startedAt
    ? applyWeekdaySeasonality(snapshot.curva, opts.startedAt)
    : snapshot.curva;

  // Prioridade: 1) positions explícito via opts; 2) position persistida em cada alloc (todas precisam ter);
  // 3) fallback: distribuição dinâmica via distributeEcoPositions. Só recálculo "automático" acontece
  // quando NINGUÉM passou positions e nenhuma alloc tem position salva (campanhas legadas).
  const allPersisted = allocs.length > 0 && allocs.every(a => Number.isFinite(a.position as number) && (a.position as number) >= 1);
  const chartTier = chartTierFromSnapshot(snapshot);
  const positions = opts.positions ?? (allPersisted
    ? new Map(allocs.map(a => [a.id, a.position as number]))
    : distributeEcoPositions(
        allocs.map(a => ({
          id: a.id,
          planned_streams: a.planned_streams,
          followers: Number(a.managed_playlists?.followers ?? 0),
          genreSource: (a as any).genre_source ?? "primary",
        })),
        planDaysOf(snapshot),
        multiplier,
        { chartTier },
      ));


  const ordered = [...allocs].sort((a, b) => b.planned_streams - a.planned_streams);
  const storedStarts = ordered.map(a => Number(a.start_day || 1));
  const generatedStarts = ordered.map((_, index) => generatedStartDay(index, ordered.length, planDaysOf(snapshot), snapshot.modo));
  const legacyStarts = ordered.map((_, index) => legacyStartDay(index, ordered.length, planDaysOf(snapshot)));
  const startsLookSystemGenerated = ordered.length > 1 && (
    storedStarts.every(s => s === 1)
    || matchesSequence(storedStarts, generatedStarts)
    || matchesSequence(storedStarts, legacyStarts)
  );

  const ecoFloorDay = snapshot.modo === "sequencial"
    ? curveThresholdDay(snapshot.curva, 0.25)
    : 1;

  // Base para fator de dia-da-semana (Dom/Seg dão dip suave).
  const startBase = opts.startedAt ? new Date(opts.startedAt) : null;
  const startValid = startBase && !isNaN(startBase.getTime());

  const plans: DailyPlaylistPlan[] = ordered.map((a, index) => {
    const baseStart = startsLookSystemGenerated
      ? generatedStarts[index]
      : effectiveEcoStartDay(index, ordered.length, planDaysOf(snapshot), a.start_day, snapshot.modo);
    const startDay = Math.min(planDaysOf(snapshot), Math.max(baseStart, ecoFloorDay));
    const followers = Number(a.managed_playlists?.followers ?? 0);
    let pos = positions.get(a.id) ?? MIN_CAMPAIGN_POSITION;
    // PISO 500/dia: PROMOVE pra posição mais profunda que ainda atende o piso
    // (nunca rebaixa — só sobe a posição/diminui o número se necessário).
    const deepestFloor = deepestPositionMeetingFloor(followers, multiplier);
    if (deepestFloor != null && pos > deepestFloor) pos = deepestFloor;
    // VERDADE: capDia da faixa = saves × (mult/30) × POSITION_PCT[pos].
    // A música fica FIXA na posição → entrega ~capDia TODO DIA, com leve
    // dip de fim-de-semana/segunda. Sem curva gaussiana, sem delay, sem jitter.
    const baseCap = Math.max(1, Math.round(calculateTrackDailyStreams(followers, multiplier, pos)));

    const planLen = planDaysOf(snapshot);
    const daily = Array.from({ length: planLen }, () => 0);
    // Rampa de saída: últimos 20% dos dias da alocação. A música é rebaixada
    // em degraus (pos → pos×2 → pos×5 → pos×15 → pos×30) e o decaimento
    // do output vem naturalmente do POSITION_PCT da nova posição. Sem fator
    // quadrático artificial — o slot pior já entrega menos por construção.
    const runLen = Math.max(1, planLen - (startDay - 1));
    const tailDays = Math.max(1, Math.round(runLen * 0.2));
    const tailStart = planLen - tailDays + 1;
    // Posição planejada por dia (rebaixamento gradual na fase de saída).
    // Fora da janela ativa também guardo a posição base — facilita o card.
    const positionByDay = Array.from({ length: planLen }, (_, i) =>
      positionForDay(pos, i + 1, tailStart, tailDays),
    );
    for (let i = startDay - 1; i < planLen; i++) {
      // Ramp suave nos primeiros dias de entrada na playlist.
      const rampIdx = i - (startDay - 1);
      const ramp = rampIdx < ECO_RAMP.length ? ECO_RAMP[rampIdx] : 1;
      // Boost algorítmico (compounding +5/-3) após a rampa.
      const growthIdx = rampIdx - ECO_RAMP.length;
      const growth = growthIdx >= 0 ? ecoGrowthFactor(growthIdx) : 1;
      // Dia da semana (se conhecido).
      let weekday = 1;
      if (startValid) {
        const d = new Date(startBase!);
        d.setDate(d.getDate() + i);
        weekday = WEEKDAY_FLAT_FACTOR[d.getDay()] ?? 1;
      }
      // Cap do dia: usa POSITION_PCT da posição planejada no dia (rebaixada
      // na fase de saída). No platô, posição = base → dayCap = baseCap.
      const dayCap = Math.max(1, Math.round(
        calculateTrackDailyStreams(followers, multiplier, positionByDay[i]),
      ));
      daily[i] = Math.max(1, Math.round(dayCap * ramp * growth * weekday));
    }

    // Downscale só é acionado se o plano teórico estourar MUITO o planned_streams
    // (folga de 5% pra absorver weekday/growth). Isso evita squashing do boost.
    const targetTotal = Math.max(0, Math.round(a.planned_streams || 0));
    const rawTotal = daily.reduce((s, v) => s + v, 0);
    if (targetTotal > 0 && rawTotal > targetTotal * 1.05) {
      let allocated = 0;
      for (let i = 0; i < daily.length; i++) {
        if (daily[i] <= 0) continue;
        const scaled = Math.max(0, Math.round((daily[i] / rawTotal) * targetTotal));
        daily[i] = Math.min(scaled, Math.max(0, targetTotal - allocated));
        allocated += daily[i];
      }
      let delta = targetTotal - allocated;
      for (let i = daily.length - 1; i >= 0 && delta !== 0; i--) {
        if (rawTotal > 0 && (daily[i] > 0 || i >= startDay - 1)) {
          daily[i] += delta;
          delta = 0;
        }
      }
    }

    const realTotal = daily.reduce((s, v) => s + v, 0);

    return {
      allocationId: a.id,
      playlistName: a.managed_playlists?.name ?? "Playlist",
      coverUrl: a.managed_playlists?.cover_url ?? null,
      followers,
      startDay,
      totalStreams: realTotal,
      daily,
      capDia: baseCap,
      overflow: 0,
      positionByDay,
    };
  });

  // Sem overflow no novo modelo: a posição já define o teto diário.
  const remaining = 0;

  const result = plans as EcoPlanResult;
  result.unmetEco = Math.max(0, Math.round(remaining));

  // Sem jitter: a faixa fica fixa na posição e entrega ~capDia todo dia
  // (só varia pelo fator de dia-da-semana já aplicado acima).

  return result;
}

export function buildExternalPlan(
  snapshot: CampaignSnapshot,
  items: ExternalPlanInput[],
  opts: { startedAt?: string } = {},
): DailyExternalPlan[] {
  const ordered = [...items].sort((a, b) => b.assigned_streams - a.assigned_streams);
  return ordered.map((item, index) => {
    const startDay = generatedStartDay(index, ordered.length, planDaysOf(snapshot), snapshot.modo);
    // Motor único: platô natural com ramp 5d + reporting delay 2d.
    // Cada curador vira fonte contínua de entrega, não pico explosivo.
    const daily = buildDailyPlateau({
      totalStreams: Number(item.assigned_streams ?? 0),
      days: planDaysOf(snapshot),
      source: "external",
      startDay,
      startedAt: opts.startedAt,
    });
    return {
      itemId: item.id,
      curatorName: item.curators?.name ?? "Curador",
      contact: item.curators?.contact ?? null,
      startDay,
      totalStreams: Number(item.assigned_streams ?? 0),
      totalCost: Number(item.assigned_cost ?? 0),
      costPerStream: Number(item.cost_per_stream ?? 0),
      daily,
    };
  });
}

export function buildDailyCampaignPlan(args: {
  snapshot: CampaignSnapshot;
  startedAt: string;
  ecoPlans: DailyPlaylistPlan[];
  externalPlans: DailyExternalPlan[];
}): DailyCampaignPlan[] {
  const { snapshot, startedAt, ecoPlans, externalPlans } = args;
  let cumulative = 0;

  return snapshot.curva.map((_, index) => {
    const eco = ecoPlans.reduce((s, p) => s + (p.daily[index] ?? 0), 0);
    const external = externalPlans.reduce((s, p) => s + (p.daily[index] ?? 0), 0);
    const total = eco + external;
    cumulative += total;

    return {
      day: index + 1,
      dateLabel: campaignDateLabel(startedAt, index + 1),
      total,
      eco,
      external,
      cumulative,
      activePlaylists: ecoPlans.filter(p => (p.daily[index] ?? 0) > 0).length,
      activeCurators: externalPlans.filter(p => (p.daily[index] ?? 0) > 0).length,
    };
  });
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportCampaignPlanCsv(args: {
  fileName: string;
  daily: DailyCampaignPlan[];
  ecoPlans: DailyPlaylistPlan[];
  externalPlans: DailyExternalPlan[];
}) {
  const rows: Array<Array<string | number>> = [["tipo", "dia", "data", "nome", "streams", "custo", "observacao"]];

  args.daily.forEach(day => {
    rows.push(["total_diario", day.day, day.dateLabel, "Campanha", day.total, "", `Eco ${day.eco} / Externo ${day.external}`]);
  });

  args.ecoPlans.forEach(plan => {
    plan.daily.forEach((streams, index) => {
      if (streams > 0) rows.push(["eco_playlist", index + 1, args.daily[index]?.dateLabel ?? "", plan.playlistName, streams, "", `entrada D${plan.startDay}`]);
    });
  });

  args.externalPlans.forEach(plan => {
    plan.daily.forEach((streams, index) => {
      if (streams > 0) rows.push(["externo_curador", index + 1, args.daily[index]?.dateLabel ?? "", plan.curatorName, streams, +(streams * plan.costPerStream).toFixed(2), `${plan.contact ?? ""} entrada D${plan.startDay}`.trim()]);
    });
  });

  const csv = rows.map(row => row.map(csvCell).join(";")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = args.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}