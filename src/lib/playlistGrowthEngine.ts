/**
 * playlistGrowthEngine — motor matemático ÚNICO de crescimento.
 *
 * Princípio: a operação gera a curva, NÃO o contrário.
 *
 * Assinatura ECO (única no sistema):
 *   • ramp suave inicial (3-5 dias, log/sqrt) — 20% → 100% do platô
 *   • platô diário estável (sem pico cinematográfico)
 *   • sazonalidade semanal leve (±15%) — picos meio de semana, dip dom/seg
 *   • reporting delay para externo (2 dias)
 *   • cauda mantém ~85% do platô (sem decay teatral)
 *
 * Usado por: campaignEngine (Calculadora), buildEcoPlaylistPlan,
 * buildExternalPlan, monitoring. Todos derivam dele.
 */

export type GrowthSource = "eco" | "external";

export interface BuildDailyPlateauInput {
  totalStreams: number;
  /** Janela total disponível (inclui startDay e reporting delay). */
  days: number;
  source: GrowthSource;
  /** Dia 1-indexed em que a entrega COMEÇA (warmup gradual nas playlists). */
  startDay?: number;
  /** Override do ramp (default: 3 eco, 5 externo). */
  rampDays?: number;
  /** Override do reporting delay (default: 0 eco, 2 externo). */
  reportingDelay?: number;
  /** Override da amplitude da sazonalidade semanal (default 0.12). */
  weekdayAmplitude?: number;
  /** Data ISO do dia 1 para sazonalidade semanal real. */
  startedAt?: string;
  /** Cauda final mantém esta fração do platô (default 0.85). */
  tailFraction?: number;
}

/**
 * Sazonalidade leve — média ≈ 1.0. Index 0=Dom .. 6=Sáb.
 * Sem picos agressivos: padrão natural de tráfego de playlist.
 */
const WEEKDAY_LIGHT: number[] = [0.92, 0.88, 1.02, 1.06, 1.08, 1.05, 0.99];

function defaultRamp(source: GrowthSource) {
  return source === "external" ? 5 : 3;
}

function defaultReportingDelay(source: GrowthSource) {
  return source === "external" ? 2 : 0;
}

/**
 * Curva de ramp: sqrt suave, começa em ~0.20 e atinge 1.0 no fim do ramp.
 * Sem aceleração agressiva.
 */
function rampFactor(dayFromStart: number, rampDays: number): number {
  if (rampDays <= 0) return 1;
  if (dayFromStart < 0) return 0;
  if (dayFromStart >= rampDays) return 1;
  const t = (dayFromStart + 1) / rampDays; // 0..1
  return 0.20 + 0.80 * Math.sqrt(t);
}

/**
 * Cauda final: nos últimos 15% da janela, decai linearmente do 1.0 → tailFraction.
 * Suave, sem decay teatral. Representa o fim natural do cronograma de entrega.
 */
function tailFactor(dayIndex: number, totalDays: number, tailFraction: number): number {
  const tailStart = Math.floor(totalDays * 0.85);
  if (dayIndex < tailStart) return 1;
  const t = (dayIndex - tailStart) / Math.max(1, totalDays - tailStart);
  return 1 - (1 - tailFraction) * t;
}

function weekdayFactor(
  dayIndex: number,
  startedAt: string | undefined,
  amplitude: number,
): number {
  if (!startedAt) return 1;
  const base = new Date(startedAt);
  if (isNaN(base.getTime())) return 1;
  const d = new Date(base);
  d.setDate(d.getDate() + dayIndex);
  const raw = WEEKDAY_LIGHT[d.getDay()] ?? 1;
  // Escala amplitude: amplitude 0 = flat, 0.12 = padrão da tabela.
  const normalized = 1 + (raw - 1) * (amplitude / 0.12);
  return Math.max(0.5, normalized);
}

/**
 * Gera vetor diário (length = days) que distribui `totalStreams` numa
 * assinatura de platô natural. Soma exata = totalStreams.
 */
export function buildDailyPlateau(input: BuildDailyPlateauInput): number[] {
  const days = Math.max(1, Math.floor(input.days));
  const total = Math.max(0, Math.round(input.totalStreams));
  const out = Array.from({ length: days }, () => 0);
  if (total === 0) return out;

  const startDay = Math.max(1, Math.min(days, Math.floor(input.startDay ?? 1)));
  const rampDays = Math.max(0, Math.floor(input.rampDays ?? defaultRamp(input.source)));
  const reportingDelay = Math.max(0, Math.floor(input.reportingDelay ?? defaultReportingDelay(input.source)));
  const weekdayAmplitude = Math.max(0, input.weekdayAmplitude ?? 0.12);
  const tailFraction = Math.max(0.4, Math.min(1, input.tailFraction ?? 0.85));

  // 1) Pesos crus: ramp × cauda × sazonalidade. Sem pico.
  const weights: number[] = Array.from({ length: days }, () => 0);
  const activeStart = startDay - 1;
  for (let i = activeStart; i < days; i++) {
    const dayFromStart = i - activeStart;
    const ramp = rampFactor(dayFromStart, rampDays);
    const tail = tailFactor(i, days, tailFraction);
    const wd = weekdayFactor(i, input.startedAt, weekdayAmplitude);
    weights[i] = Math.max(0, ramp * tail * wd);
  }

  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weightSum <= 0) {
    // Fallback: split flat.
    const flat = Math.floor(total / days);
    for (let i = 0; i < days; i++) out[i] = flat;
    out[days - 1] += total - flat * days;
    return out;
  }

  // 2) Aloca proporcional aos pesos; último ativo absorve o residual.
  let allocated = 0;
  let lastActiveIdx = activeStart;
  for (let i = activeStart; i < days; i++) {
    if (weights[i] > 0) lastActiveIdx = i;
  }
  for (let i = activeStart; i < days; i++) {
    if (i === lastActiveIdx) continue;
    const v = Math.round((weights[i] / weightSum) * total);
    out[i] = v;
    allocated += v;
  }
  out[lastActiveIdx] = Math.max(0, total - allocated);

  // 3) Reporting delay: shift dos streams contabilizados para frente.
  if (reportingDelay > 0) {
    const shifted = Array.from({ length: days }, () => 0);
    for (let i = 0; i < days; i++) {
      if (out[i] <= 0) continue;
      const t = Math.min(days - 1, i + reportingDelay);
      shifted[t] += out[i];
    }
    for (let i = 0; i < days; i++) out[i] = shifted[i];
  }

  return out;
}

/**
 * Soma vetorial dia-a-dia de várias séries (mesmo length).
 */
export function sumDaily(...series: number[][]): number[] {
  const len = Math.max(0, ...series.map(s => s.length));
  const out = Array.from({ length: len }, () => 0);
  for (const s of series) {
    for (let i = 0; i < s.length; i++) out[i] += s[i] ?? 0;
  }
  return out;
}
