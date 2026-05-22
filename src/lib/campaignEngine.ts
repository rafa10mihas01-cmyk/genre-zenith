/**
 * Calculadora de Campanha — engine matemática.
 * Ported from the original "Synka" calculator, adaptado ao NexEngine.
 *
 * Constantes de custo (R$ por stream):
 *   - Ecossistema próprio: R$ 0,028 (R$ 28.000 / 1.000.000)
 *   - Externo:             R$ 0,040 (R$ 40.000 / 1.000.000)
 * Split padrão: 60% eco / 40% externo.
 */

/**
 * Defaults usados quando o usuário ainda não configurou `pricing_settings`.
 * Toda função aqui aceita um override opcional `costs` — quem chama deve
 * passar `usePricingSettings().costs` quando logado.
 */
export const COST_PER_STREAM = {
  eco: 0.028,
  ext: 0.040,
} as const;

export type CostPerStream = { eco: number; ext: number };

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

import { buildDailyPlateau, sumDaily } from "./playlistGrowthEngine";

/**
 * Curva derivada da OPERAÇÃO simulada — não mais uma forma artística imposta.
 *
 * Modelo:
 *   1. Simula N fontes eco (platô natural, ramp 3d, sem delay)
 *   2. Simula M fontes externas (platô natural, ramp 5d, delay 2d)
 *   3. Soma dia-a-dia → curva final
 *
 * O resultado é a assinatura ECO única do sistema: ramp suave + platô estável
 * + sazonalidade leve + cauda mantida. Sem pico cinematográfico, sem decay
 * teatral. O cliente vê o que a operação realmente entrega.
 *
 * `modo` afeta o ESCALONAMENTO de entrada (sequencial = warmup mais longo
 * entre fontes); `inercia` afeta a amplitude da sazonalidade semanal
 * (engajado = pouquíssima variação; frio = mais flutuação natural).
 */
function buildCurve(
  meta: number,
  days: number,
  modo: Modo,
  inercia: number,
  splitEcoPct: number,
): CurvaPonto[] {
  if (days <= 0 || meta <= 0) return [];

  const ecoFrac = Math.min(1, Math.max(0, splitEcoPct / 100));
  const streamsEco = Math.round(meta * ecoFrac);
  const streamsExt = meta - streamsEco;

  // Fontes simuladas: heurística simples — escala com a meta.
  // Eco: 1 playlist por ~3k streams (mín 1, máx 24).
  // Ext: 1 curador por ~5k streams (mín 1, máx 16).
  const ecoSources = streamsEco > 0
    ? Math.max(1, Math.min(24, Math.round(streamsEco / 3000)))
    : 0;
  const extSources = streamsExt > 0
    ? Math.max(1, Math.min(16, Math.round(streamsExt / 5000)))
    : 0;

  // Sequencial: warmup ocupa ~70% da janela. Simultâneo: ~25%.
  const rampPct = modo === "sequencial" ? 0.7 : 0.25;
  const rampWindow = Math.max(2, Math.ceil(days * rampPct));

  // Inércia altera amplitude semanal: engajado mais estável, frio mais ruidoso.
  // INERCIA: frio 0.85, mercado 1.0, engajado 1.18.
  const weekdayAmplitude = Math.max(0.04, 0.15 - (inercia - 1) * 0.15);

  function startDayFor(index: number, total: number): number {
    if (total <= 1) return 1;
    return Math.min(days, 1 + Math.floor((index / (total - 1)) * (rampWindow - 1)));
  }

  function splitEvenly(total: number, parts: number): number[] {
    if (parts <= 0 || total <= 0) return [];
    const base = Math.floor(total / parts);
    const arr = Array.from({ length: parts }, () => base);
    arr[parts - 1] += total - base * parts;
    return arr;
  }

  const ecoSeries: number[][] = [];
  for (let i = 0; i < ecoSources; i++) {
    const slice = splitEvenly(streamsEco, ecoSources)[i] ?? 0;
    ecoSeries.push(buildDailyPlateau({
      totalStreams: slice,
      days,
      source: "eco",
      startDay: startDayFor(i, ecoSources),
      weekdayAmplitude,
    }));
  }

  const extSeries: number[][] = [];
  for (let i = 0; i < extSources; i++) {
    const slice = splitEvenly(streamsExt, extSources)[i] ?? 0;
    extSeries.push(buildDailyPlateau({
      totalStreams: slice,
      days,
      source: "external",
      startDay: startDayFor(i, extSources),
      weekdayAmplitude,
    }));
  }

  const ecoDaily = sumDaily(...ecoSeries);
  const extDaily = sumDaily(...extSeries);
  // Garante length = days mesmo quando uma das séries está vazia.
  while (ecoDaily.length < days) ecoDaily.push(0);
  while (extDaily.length < days) extDaily.push(0);

  let cum = 0;
  const result: CurvaPonto[] = [];
  for (let i = 0; i < days; i++) {
    const e = ecoDaily[i] ?? 0;
    const x = extDaily[i] ?? 0;
    const total = e + x;
    cum += total;
    result.push({
      day: i + 1,
      streamsDay: total,
      streamsEcoDay: e,
      streamsExtDay: x,
      cumulative: cum,
    });
  }

  // Normaliza para bater exatamente em meta (corrige arredondamentos do split).
  const sum = result.reduce((s, p) => s + p.streamsDay, 0);
  const delta = meta - sum;
  if (delta !== 0 && result.length > 0) {
    // Distribui delta no último dia ativo.
    let lastIdx = result.length - 1;
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].streamsDay > 0) { lastIdx = i; break; }
    }
    result[lastIdx].streamsDay = Math.max(0, result[lastIdx].streamsDay + delta);
    // Re-split eco/ext proporcional, re-cumulative.
    let cum2 = 0;
    for (let i = 0; i < result.length; i++) {
      const p = result[i];
      const ratio = (p.streamsEcoDay + p.streamsExtDay) > 0
        ? p.streamsEcoDay / (p.streamsEcoDay + p.streamsExtDay)
        : ecoFrac;
      const eco = Math.round(p.streamsDay * ratio);
      p.streamsEcoDay = eco;
      p.streamsExtDay = Math.max(0, p.streamsDay - eco);
      cum2 += p.streamsDay;
      p.cumulative = cum2;
    }
  }

  return result;
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
