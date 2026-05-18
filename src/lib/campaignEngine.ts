/**
 * Calculadora de Campanha — engine matemática.
 * Ported from the original "Synka" calculator, adaptado ao NexEngine.
 *
 * Constantes de custo (R$ por stream):
 *   - Ecossistema próprio: R$ 0,028 (R$ 28.000 / 1.000.000)
 *   - Externo:             R$ 0,040 (R$ 40.000 / 1.000.000)
 * Split padrão: 60% eco / 40% externo.
 */

export const COST_PER_STREAM = {
  eco: 0.028,
  ext: 0.040,
} as const;

export const DEFAULT_SPLIT = { eco: 60, ext: 40 } as const;

export type Modo = "simultaneo" | "sequencial";

export type Perfil = "frio" | "mercado" | "engajado";

/** Multiplicador de inércia: quanto a curva mantém entrega após o pico. */
export const INERCIA_BY_PERFIL: Record<Perfil, number> = {
  frio: 0.85,
  mercado: 1.0,
  engajado: 1.18,
};

export interface CampaignInput {
  meta: number;              // streams totais
  days: number;              // duração em dias
  modo: Modo;
  perfil: Perfil;
  splitEcoPct: number;       // 0-100, ex 60
}

export interface CurvaPonto {
  day: number;
  streamsDay: number;        // streams entregues no dia (total)
  streamsEcoDay: number;     // parte vinda do ecossistema próprio
  streamsExtDay: number;     // parte vinda do externo
  cumulative: number;        // acumulado total
}

export interface CampaignResult {
  meta: number;
  days: number;
  modo: Modo;
  perfil: Perfil;
  splitEcoPct: number;

  // Distribuição
  streamsEco: number;
  streamsExt: number;

  // Custos
  custoEco: number;          // R$
  custoExt: number;          // R$
  custoTotal: number;        // R$
  custoPorStream: number;    // R$ médio

  // Operação
  picoPorDia: number;        // pico de streams/dia
  mediaPorDia: number;
  inercia: number;

  // Curva
  curva: CurvaPonto[];
}

/**
 * Forma realista de ciclo de vida de playlist (substitui gaussiana simétrica).
 * Curva assimétrica: ramp lento → aceleração → pico tardio (~80% do período) → sustentação ondulada.
 * Portado da calculadora antiga (campaignCurve.ts → playlistFactor).
 */
function playlistFactor(dayInPeriod: number, periodDays: number): number {
  const useful = Math.max(1, periodDays);
  const day = Math.max(1, Math.min(useful, dayInPeriod));
  const p = day / useful; // 0..1

  const e1 = 3 / 30;   // 10% — delay
  const e2 = 7 / 30;   // 23% — indexação
  const e3 = 14 / 30;  // 47% — aceleração
  const e4 = 24 / 30;  // 80% — pico/platô

  if (p <= e1) {
    const t = p / e1;
    return 0.0 + 0.05 * (t * t);
  }
  if (p <= e2) {
    const t = (p - e1) / (e2 - e1);
    return 0.10 + 0.20 * t;
  }
  if (p <= e3) {
    const t = (p - e2) / (e3 - e2);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    return 0.30 + 0.50 * eased;
  }
  if (p <= e4) {
    const t = (p - e3) / (e4 - e3);
    return 0.80 + 0.20 * Math.sin((t * Math.PI) / 2);
  }
  // Sustentação: decay real (desmama de ~100% pra ~25% no último dia).
  const t = (p - e4) / (1 - e4);
  const eased = 1 - Math.pow(1 - t, 2);
  return 1.0 - (1.0 - 0.25) * eased;
}

function buildCurve(
  meta: number,
  days: number,
  modo: Modo,
  inercia: number,
  splitEcoPct: number,
): CurvaPonto[] {
  if (days <= 0 || meta <= 0) return [];

  const ecoFrac = Math.min(1, Math.max(0, splitEcoPct / 100));
  const extFrac = 1 - ecoFrac;

  // 1) Gera fatores brutos (forma assimétrica de playlist) com inércia estendendo a cauda.
  const raw: number[] = [];
  for (let d = 1; d <= days; d++) {
    const base = playlistFactor(d, days);
    // Inércia >1 dá um leve lift na segunda metade (perfil engajado segura mais).
    const tail = inercia > 1 ? 1 + (inercia - 1) * Math.max(0, (d / days) - 0.5) * 0.6 : inercia;
    raw.push(base * tail);
  }

  // 2) Modo: sequencial concentra um pouco mais no pico, simultâneo achata.
  const concentrate = modo === "sequencial" ? 1.15 : 0.95;
  const shaped = raw.map(v => Math.pow(v, concentrate));

  // 3) Normaliza pra bater exatamente em meta.
  const sum = shaped.reduce((a, b) => a + b, 0);
  const factor = sum > 0 ? meta / sum : 0;
  const scaled = shaped.map(w => w * factor);

  let cum = 0;
  let allocated = 0;
  return scaled.map((v, i) => {
    const isLast = i === scaled.length - 1;
    const streamsDay = isLast ? Math.max(0, meta - allocated) : Math.round(v);
    allocated += streamsDay;
    cum += streamsDay;
    const streamsEcoDay = Math.round(streamsDay * ecoFrac);
    const streamsExtDay = Math.max(0, streamsDay - streamsEcoDay);
    return { day: i + 1, streamsDay, streamsEcoDay, streamsExtDay, cumulative: cum };
  });
}


export function calcCampaign(input: CampaignInput): CampaignResult {
  const meta = Math.max(0, Math.round(input.meta));
  const days = Math.max(1, Math.round(input.days));
  const splitEcoPct = Math.min(100, Math.max(0, input.splitEcoPct));
  const splitExtPct = 100 - splitEcoPct;
  const inercia = INERCIA_BY_PERFIL[input.perfil];

  const streamsEco = Math.round((meta * splitEcoPct) / 100);
  const streamsExt = meta - streamsEco;

  const custoEco = streamsEco * COST_PER_STREAM.eco;
  const custoExt = streamsExt * COST_PER_STREAM.ext;
  const custoTotal = custoEco + custoExt;
  const custoPorStream = meta > 0 ? custoTotal / meta : 0;

  const curva = buildCurve(meta, days, input.modo, inercia, splitEcoPct);
  const picoPorDia = curva.reduce((m, p) => Math.max(m, p.streamsDay), 0);
  const mediaPorDia = meta / days;

  return {
    meta,
    days,
    modo: input.modo,
    perfil: input.perfil,
    splitEcoPct,
    streamsEco,
    streamsExt,
    custoEco,
    custoExt,
    custoTotal,
    custoPorStream,
    picoPorDia,
    mediaPorDia,
    inercia,
    curva,
  };
}

/**
 * Modo reverso: dado um orçamento, retorna a meta (streams) atingível
 * mantendo o mesmo split eco/ext.
 */
export function reverseFromBudget(budget: number, splitEcoPct: number): number {
  const ecoFrac = splitEcoPct / 100;
  const extFrac = 1 - ecoFrac;
  // budget = meta * (ecoFrac * COST_eco + extFrac * COST_ext)
  const blended = ecoFrac * COST_PER_STREAM.eco + extFrac * COST_PER_STREAM.ext;
  if (blended <= 0) return 0;
  return Math.floor(budget / blended);
}

/** Estima posição no Top 200 a partir de streams/dia médios. */
export function estimatePosition(
  streamsPerDay: number,
  benchmarks: { position: number; streams_day: number }[],
): number | null {
  if (!benchmarks.length) return null;
  const sorted = [...benchmarks].sort((a, b) => a.position - b.position);
  for (const b of sorted) {
    if (streamsPerDay >= b.streams_day) return b.position;
  }
  return null; // abaixo do Top 200
}

export function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function formatInt(v: number): string {
  return Math.round(v).toLocaleString("pt-BR");
}
