import type { CampaignSnapshot } from "@/lib/campaignSnapshot";

export type EcoPlanInput = {
  id: string;
  planned_streams: number;
  start_day: number;
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
/** Fator de capacidade diária por playlist eco — proxy realista. */
export const ECO_CAPACITY_FACTOR = 0.6;
/** Ramp de entrada de playlist eco nos primeiros dias. */
export const ECO_RAMP = [0.2, 0.4, 0.6, 0.8, 1.0];

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

export function buildEcoPlaylistPlan(snapshot: CampaignSnapshot, allocs: EcoPlanInput[]): DailyPlaylistPlan[] {
  const ordered = [...allocs].sort((a, b) => b.planned_streams - a.planned_streams);
  const storedStarts = ordered.map(a => Number(a.start_day || 1));
  const generatedStarts = ordered.map((_, index) => generatedStartDay(index, ordered.length, snapshot.days, snapshot.modo));
  const legacyStarts = ordered.map((_, index) => legacyStartDay(index, ordered.length, snapshot.days));
  const startsLookSystemGenerated = ordered.length > 1 && (
    storedStarts.every(s => s === 1)
    || matchesSequence(storedStarts, generatedStarts)
    || matchesSequence(storedStarts, legacyStarts)
  );

  // No sequencial, eco só entra após externo bater ~25% da meta.
  const ecoFloorDay = snapshot.modo === "sequencial"
    ? curveThresholdDay(snapshot.curva, 0.25)
    : 1;

  return ordered.map((a, index) => {
    const baseStart = startsLookSystemGenerated
      ? generatedStarts[index]
      : effectiveEcoStartDay(index, ordered.length, snapshot.days, a.start_day, snapshot.modo);
    const startDay = Math.min(snapshot.days, Math.max(baseStart, ecoFloorDay));

    return {
      allocationId: a.id,
      playlistName: a.managed_playlists?.name ?? "Playlist",
      coverUrl: a.managed_playlists?.cover_url ?? null,
      followers: Number(a.managed_playlists?.followers ?? 0),
      startDay,
      totalStreams: Number(a.planned_streams ?? 0),
      daily: distributeByCurve(Number(a.planned_streams ?? 0), snapshot.curva, startDay),
    };
  });
}

export function buildExternalPlan(snapshot: CampaignSnapshot, items: ExternalPlanInput[]): DailyExternalPlan[] {
  const ordered = [...items].sort((a, b) => b.assigned_streams - a.assigned_streams);
  return ordered.map((item, index) => {
    const startDay = generatedStartDay(index, ordered.length, snapshot.days, snapshot.modo);
    return {
      itemId: item.id,
      curatorName: item.curators?.name ?? "Curador",
      contact: item.curators?.contact ?? null,
      startDay,
      totalStreams: Number(item.assigned_streams ?? 0),
      totalCost: Number(item.assigned_cost ?? 0),
      costPerStream: Number(item.cost_per_stream ?? 0),
      daily: distributeByCurve(Number(item.assigned_streams ?? 0), snapshot.curva, startDay),
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