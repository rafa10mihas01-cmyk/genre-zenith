// Peso temporal — reutilizado em todo o Genre Brain.
// Curva: quanto mais antigo o evento, menos peso ele tem na decisão atual.
//
//   30d  -> 1.00  (altíssimo)
//   90d  -> 0.70  (alto)
//  180d  -> 0.45  (médio)
//  365d  -> 0.20  (penalidade)
//  >365d -> 0.05  (quase ignorado)
//
// Use sempre que precisar agregar evidências históricas (tracks, snapshots,
// search_results, capas, etc).
export function recencyWeight(date: string | Date | null | undefined, ref: Date = new Date()): number {
  if (!date) return 0.05;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return 0.05;
  const days = (ref.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 30) return 1.0;
  if (days <= 90) return 1.0 - ((days - 30) / 60) * 0.30;   // 1.00 -> 0.70
  if (days <= 180) return 0.70 - ((days - 90) / 90) * 0.25; // 0.70 -> 0.45
  if (days <= 365) return 0.45 - ((days - 180) / 185) * 0.25; // 0.45 -> 0.20
  return 0.05;
}

/** Versão batch — soma pesos de uma lista de datas. */
export function sumRecencyWeights(dates: Array<string | Date | null | undefined>, ref?: Date): number {
  return dates.reduce<number>((acc, d) => acc + recencyWeight(d, ref), 0);
}

/** Normaliza um número pra range [0, 1] dado um teto observado. */
export function normalize(value: number, ceiling: number): number {
  if (ceiling <= 0) return 0;
  return Math.max(0, Math.min(1, value / ceiling));
}

/** Buckets temporais discretos (Fase 9 — recorrência ponderada).
 *  Mais agressivo que recencyWeight: faz tracks/eventos antigos
 *  pararem de dominar o ranking cultural.
 *      <=  30d -> 1.00
 *      <=  90d -> 0.70
 *      <= 180d -> 0.40
 *      <= 365d -> 0.15
 *      > 365d  -> 0.05
 */
export function temporalWeight(daysOrDate: number | string | Date | null | undefined, ref: Date = new Date()): number {
  let days: number;
  if (daysOrDate == null) return 0.05;
  if (typeof daysOrDate === "number") {
    days = daysOrDate;
  } else {
    const d = typeof daysOrDate === "string" ? new Date(daysOrDate) : daysOrDate;
    if (isNaN(d.getTime())) return 0.05;
    days = (ref.getTime() - d.getTime()) / 86400_000;
  }
  if (days <= 30) return 1.0;
  if (days <= 90) return 0.7;
  if (days <= 180) return 0.4;
  if (days <= 365) return 0.15;
  return 0.05;
}

/** Freshness 0–1 baseado em quão recente foi a última atualização. */
export function recencyFactor(lastAt: string | Date | null | undefined, ref: Date = new Date()): number {
  if (!lastAt) return 0;
  const d = typeof lastAt === "string" ? new Date(lastAt) : lastAt;
  if (isNaN(d.getTime())) return 0;
  const days = (ref.getTime() - d.getTime()) / 86400_000;
  if (days <= 7) return 1;
  if (days >= 90) return 0;
  return 1 - (days - 7) / 83;
}

