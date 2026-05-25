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
  days: number;              // duração CONTRATADA (o que o cliente pediu)
  effectiveDays: number;     // duração REAL do plano (ceil(days × 1.5)) —
                             // inclui rampa de entrada + platô + saída suave
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

  // Curva (length = effectiveDays)
  curva: CurvaPonto[];
}

/** Multiplicador interno fixo: usuário pede N dias plenos → motor opera em N×1.5. */
export const EFFECTIVE_DAYS_MULTIPLIER = 1.5;

/** Repartição interna fixa da janela efetiva: rampa / platô / saída. */
export const PHASE_PCT = { ramp: 0.28, plateau: 0.56, outro: 0.16 } as const;

/** Calcula a duração real do plano a partir da contratada. */
export function toEffectiveDays(days: number): number {
  return Math.max(1, Math.ceil(Math.max(1, Math.round(days)) * EFFECTIVE_DAYS_MULTIPLIER));
}

/** Dias por fase a partir de effectiveDays — soma sempre == effectiveDays. */
export function computePhaseDays(effectiveDays: number): { ramp: number; plateau: number; outro: number } {
  const d = Math.max(3, Math.round(effectiveDays));
  const ramp = Math.max(1, Math.round(d * PHASE_PCT.ramp));
  const outro = Math.max(1, Math.round(d * PHASE_PCT.outro));
  const plateau = Math.max(1, d - ramp - outro);
  return { ramp, plateau, outro };
}

/**
 * Curva interna com envelope FIXO em 3 fases:
 *   rampa de entrada (22% dos effectiveDays) — smoothstep subindo de 0 → 1
 *   platô pleno    (62%) — peso 1 com leve sazonalidade semanal (inercia)
 *   saída suave    (16%) — smoothstep descendo de 1 → 0
 *
 * `modo` NÃO afeta o shape geral aqui (a forma é sempre 22/62/16). O `modo`
 * continua afetando apenas o warmup ENTRE FONTES (em `planEcoAllocations` /
 * `computeEcoPlan` via `start_day` de cada playlist).
 *
 * `inercia` afeta só a amplitude da micro-variação semanal do platô.
 */
export function buildCurve(
  meta: number,
  effectiveDays: number,
  _modo: Modo,
  inercia: number,
  splitEcoPct: number,
): CurvaPonto[] {
  const days = Math.max(1, Math.round(effectiveDays));
  if (days <= 0 || meta <= 0) return [];

  const ecoFrac = Math.min(1, Math.max(0, splitEcoPct / 100));
  const { ramp: rampDays, plateau: plateauDays, outro: outroDays } = computePhaseDays(days);

  // smoothstep S(t) = t²·(3 − 2t) — suave nas pontas, sem cantos.
  const S = (t: number) => {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  };

  // Amplitude semanal: frio 0.15, mercado 0, engajado < 0. Clamp ≥ 0.
  const weekdayAmp = Math.max(0, 0.15 - (inercia - 1) * 0.15);

  const weights: number[] = new Array(days).fill(0);
  // Rampa: 0 → 1 com easeInCubic t³ — sobe ainda mais devagar no início e
  // empurra o "joelho" pro fim da fase (dia 10-11), evitando atingir o platô
  // cedo demais. (Saída segue smoothstep — descida suave faz sentido manter simétrica.)
  for (let i = 0; i < rampDays; i++) {
    const t = (i + 1) / rampDays;
    weights[i] = t * t * t;
  }

  // Platô: peso ≈ 1 com leve sazonalidade.
  for (let i = 0; i < plateauDays; i++) {
    const idx = rampDays + i;
    const wk = weekdayAmp > 0
      ? 1 + weekdayAmp * 0.5 * Math.sin((i / 7) * Math.PI * 2)
      : 1;
    weights[idx] = wk;
  }
  // Saída: 1 → 0 (smoothstep invertido).
  for (let i = 0; i < outroDays; i++) {
    const idx = rampDays + plateauDays + i;
    weights[idx] = S(1 - (i + 1) / outroDays);
  }

  const sumW = weights.reduce((s, w) => s + w, 0);
  if (sumW <= 0) return [];

  // Distribui meta proporcional ao envelope; corrige resíduo no último dia ativo.
  const result: CurvaPonto[] = [];
  let allocated = 0;
  let cum = 0;
  for (let i = 0; i < days; i++) {
    const isLast = i === days - 1;
    const sd = isLast
      ? Math.max(0, meta - allocated)
      : Math.round((meta * weights[i]) / sumW);
    allocated += sd;
    const eco = Math.round(sd * ecoFrac);
    const ext = Math.max(0, sd - eco);
    cum += sd;
    result.push({
      day: i + 1,
      streamsDay: sd,
      streamsEcoDay: eco,
      streamsExtDay: ext,
      cumulative: cum,
    });
  }
  return result;
}


export function calcCampaign(input: CampaignInput, costs: CostPerStream = COST_PER_STREAM): CampaignResult {
  const meta = Math.max(0, Math.round(input.meta));
  const days = Math.max(1, Math.round(input.days));
  const effectiveDays = toEffectiveDays(days);
  const splitEcoPct = Math.min(100, Math.max(0, input.splitEcoPct));
  const inercia = INERCIA_BY_PERFIL[input.perfil];

  const streamsEco = Math.round((meta * splitEcoPct) / 100);
  const streamsExt = meta - streamsEco;

  const custoEco = streamsEco * costs.eco;
  const custoExt = streamsExt * costs.ext;
  const custoTotal = custoEco + custoExt;
  const custoPorStream = meta > 0 ? custoTotal / meta : 0;

  const curva = buildCurve(meta, effectiveDays, input.modo, inercia, splitEcoPct);
  const picoPorDia = curva.reduce((m, p) => Math.max(m, p.streamsDay), 0);
  // Média diária reflete a duração REAL do plano (motor opera em effectiveDays).
  const mediaPorDia = effectiveDays > 0 ? meta / effectiveDays : 0;

  return {
    meta, days, effectiveDays, modo: input.modo, perfil: input.perfil, splitEcoPct,
    streamsEco, streamsExt,
    custoEco, custoExt, custoTotal, custoPorStream,
    picoPorDia, mediaPorDia, inercia, curva,
  };
}

/**
 * Recalcula APENAS a forma da curva (streamsDay/cumulative) a partir de
 * meta + effectiveDays, aplicando o envelope canônico ATUAL do motor.
 *
 * Uso: substituir `snapshot.curva` salvo no banco (potencialmente com
 * envelope antigo) por uma curva fresca, sem alterar meta/custos/split.
 * O snapshot continua sendo fonte de verdade pra meta, effectiveDays e split.
 */
export function recomputeCurva(
  meta: number,
  effectiveDays: number,
  splitEcoPct: number = DEFAULT_SPLIT.eco,
  perfil: Perfil = "mercado",
  modo: Modo = "simultaneo",
): CurvaPonto[] {
  const m = Math.max(0, Math.round(meta));
  const d = Math.max(1, Math.round(effectiveDays));
  const split = Math.min(100, Math.max(0, splitEcoPct));
  const inercia = INERCIA_BY_PERFIL[perfil] ?? 1;
  return buildCurve(m, d, modo, inercia, split);
}





/**
 * Modo reverso: dado um orçamento, retorna a meta (streams) atingível
 * mantendo o mesmo split eco/ext.
 */
export function reverseFromBudget(budget: number, splitEcoPct: number, costs: CostPerStream = COST_PER_STREAM): number {
  const ecoFrac = splitEcoPct / 100;
  const extFrac = 1 - ecoFrac;
  const blended = ecoFrac * costs.eco + extFrac * costs.ext;
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
