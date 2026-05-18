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
  streamsDay: number;        // streams entregues no dia
  cumulative: number;        // acumulado
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
 * Gera curva-S para a campanha.
 * - Simultâneo: distribuição mais uniforme com leve pico no meio.
 * - Sequencial: pico mais marcado (ramp-up + platô + decay).
 */
/** Limite de pico/média — campanhas reais raramente passam de 1,8× a média. */
const MAX_PEAK_TO_MEAN = 1.8;

/** Achata picos acima de `ratio × média`, redistribuindo o excedente para dias com folga. */
function flattenPeak(values: number[], ratio = MAX_PEAK_TO_MEAN): number[] {
  if (values.length === 0) return values;
  const total = values.reduce((a, b) => a + b, 0);
  const mean = total / values.length;
  const cap = mean * ratio;
  const arr = values.slice();
  for (let iter = 0; iter < 30; iter++) {
    let overflow = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > cap) {
        overflow += arr[i] - cap;
        arr[i] = cap;
      }
    }
    if (overflow < 1) break;
    const room = arr.map(v => Math.max(0, cap - v));
    const roomSum = room.reduce((a, b) => a + b, 0);
    if (roomSum <= 0) break;
    for (let i = 0; i < arr.length; i++) {
      arr[i] += overflow * (room[i] / roomSum);
    }
  }
  return arr;
}

function buildCurve(meta: number, days: number, modo: Modo, inercia: number): CurvaPonto[] {
  if (days <= 0 || meta <= 0) return [];

  // Forma da curva: gaussian-like centrada. Sigma maior = curva mais achatada.
  const center = days / 2;
  // Largura: simultâneo bem largo, sequencial só um pouco mais estreito.
  const sigma = modo === "simultaneo" ? days / 1.8 : days / 2.2;

  const raw: number[] = [];
  for (let d = 1; d <= days; d++) {
    const x = d - center;
    // Gaussiana ajustada pela inércia (estende a cauda)
    const weight = Math.exp(-(x * x) / (2 * sigma * sigma));
    const tail = inercia > 1 ? 1 + (inercia - 1) * (d / days) : inercia;
    raw.push(weight * tail);
  }

  const sum = raw.reduce((a, b) => a + b, 0);
  const factor = meta / sum;
  const scaled = raw.map(w => w * factor);
  // Achata picos para garantir pico ≤ 1.8 × média (realismo operacional).
  const flat = flattenPeak(scaled, MAX_PEAK_TO_MEAN);

  // Reajusta soma para bater exatamente em `meta` (compensa arredondamentos).
  const flatSum = flat.reduce((a, b) => a + b, 0);
  const adj = flatSum > 0 ? meta / flatSum : 1;

  let cum = 0;
  let allocated = 0;
  return flat.map((v, i) => {
    const isLast = i === flat.length - 1;
    const streamsDay = isLast ? Math.max(0, meta - allocated) : Math.round(v * adj);
    allocated += streamsDay;
    cum += streamsDay;
    return { day: i + 1, streamsDay, cumulative: cum };
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

  const curva = buildCurve(meta, days, input.modo, inercia);
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
