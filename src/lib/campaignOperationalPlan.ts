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
};

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
/** Ramp de entrada de playlist eco nos primeiros dias. */
export const ECO_RAMP = [0.2, 0.4, 0.6, 0.8, 1.0];

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

/**
 * Distribui posições para um lote, com anti-saturação: limita a fração de
 * faixas em slots fortes (#3-5). Se passar do teto, empurra próximas pra
 * slots médios/cauda. Determinístico (seed por id da alocação).
 */
export function distributeEcoPositions(
  allocs: EcoPositionInput[],
  days: number,
  engagementMultiplier = 30,
  opts: { strongSlotShareCap?: number; preferredSlots?: number[] } = {},
): Map<string, number> {
  const preferredSlots = (opts.preferredSlots ?? []).filter((p) => Number.isFinite(p) && p >= 1);
  const cap = opts.strongSlotShareCap ?? 0.4;
  const total = allocs.length;
  const maxStrong = Math.max(1, Math.floor(total * cap));
  const ordered = [...allocs].sort((a, b) => b.followers - a.followers);
  const result = new Map<string, number>();
  if (preferredSlots.length > 0) {
    ordered.forEach((a, index) => result.set(a.id, preferredSlots[index % preferredSlots.length] ?? MIN_CAMPAIGN_POSITION));
    return result;
  }
  let strongUsed = 0;

  for (const a of ordered) {
    const tier = classifyPlaylistSize(a.followers);
    const rng = seededRng(`pos:${a.id}`);
    let [lo, hi] = pickBucket(rng, tier);
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
    const candidate = lo + Math.floor(rng() * (hi - lo + 1));
    const viable = maxViablePosition(a.planned_streams, days, a.followers, engagementMultiplier);
    // Slot mais fraco aceitável = `viable`. Se o sorteio caiu mais fraco que isso, sobe.
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
  const positions = opts.positions ?? (allPersisted
    ? new Map(allocs.map(a => [a.id, a.position as number]))
    : distributeEcoPositions(
        allocs.map(a => ({
          id: a.id,
          planned_streams: a.planned_streams,
          followers: Number(a.managed_playlists?.followers ?? 0),
        })),
        planDaysOf(snapshot),
        multiplier,
        { preferredSlots: inferEcoPreferredPositions(snapshot, allocs.map(a => ({
          id: a.id,
          planned_streams: a.planned_streams,
          followers: Number(a.managed_playlists?.followers ?? 0),
        })), multiplier) },
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
    const pos = positions.get(a.id) ?? MIN_CAMPAIGN_POSITION;
    // VERDADE: capDia da faixa = saves × (mult/30) × POSITION_PCT[pos].
    // A música fica FIXA na posição → entrega ~capDia TODO DIA, com leve
    // dip de fim-de-semana/segunda. Sem curva gaussiana, sem delay, sem jitter.
    const baseCap = Math.max(1, Math.round(calculateTrackDailyStreams(followers, multiplier, pos)));

    const daily = Array.from({ length: planDaysOf(snapshot) }, () => 0);
    for (let i = startDay - 1; i < planDaysOf(snapshot); i++) {
      // Ramp suave nos primeiros dias de entrada na playlist.
      const rampIdx = i - (startDay - 1);
      const ramp = rampIdx < ECO_RAMP.length ? ECO_RAMP[rampIdx] : 1;
      // Dia da semana (se conhecido).
      let weekday = 1;
      if (startValid) {
        const d = new Date(startBase!);
        d.setDate(d.getDate() + i);
        weekday = WEEKDAY_FLAT_FACTOR[d.getDay()] ?? 1;
      }
      daily[i] = Math.max(1, Math.round(baseCap * ramp * weekday));
    }

    const targetTotal = Math.max(0, Math.round(a.planned_streams || 0));
    const rawTotal = daily.reduce((s, v) => s + v, 0);
    if (targetTotal > 0 && rawTotal > targetTotal) {
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