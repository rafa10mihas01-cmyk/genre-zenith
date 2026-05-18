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

function campaignDateLabel(startedAt: string, day: number) {
  const base = new Date(startedAt);
  base.setDate(base.getDate() + day - 1);
  return base.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function distributeByCurve(total: number, curva: CampaignSnapshot["curva"], startDay = 1) {
  const days = curva.length;
  const daily = Array.from({ length: days }, () => 0);
  if (total <= 0 || days === 0) return daily;

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

  return daily;
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

  return ordered.map((a, index) => {
    const startDay = startsLookSystemGenerated
      ? generatedStarts[index]
      : effectiveEcoStartDay(index, ordered.length, snapshot.days, a.start_day, snapshot.modo);

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