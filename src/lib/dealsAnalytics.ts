// dealsAnalytics — helpers puros pro /analytics.
//
// FASE 13.0 — Fonte canônica: vw_campaign_playlist_growth (delivery_accumulated
// já consolidado pela view) + campaign_playlist_collections (raw para série
// temporal de momentum). curator_deal_snapshots NÃO é mais consumido.
//
// Modelo:
//   GrowthRow: (campaign_id, playlist_id, baseline_plays, current_plays,
//               delivery_accumulated, baseline_at, last_captured_at,
//               attributed_to) — VEM PRONTO da view, sem recálculo local
//   CpcRow:    (campaign_id, playlist_id, plays_7d, captured_at) — raw
//   Deal:      (id, state, target_plays, baseline_plays, cost, started_at,
//               ends_at, song_artist, song_name, campaign_id, curator_id)

export type GrowthRow = {
  campaign_id: string;
  playlist_id: string;
  baseline_plays: number | null;
  current_plays: number | null;
  delivery_accumulated: number | null;
  baseline_at: string | null;
  last_captured_at: string | null;
  attributed_to: string | null;
};

export type CpcRow = {
  campaign_id: string;
  playlist_id: string;
  plays_7d: number | null;
  captured_at: string;
};

export type Deal = {
  id: string;
  state: string | null;
  song_artist: string | null;
  song_name: string | null;
  target_plays: number | null;
  baseline_plays: number | null;
  cost: number | null;
  started_at: string | null;
  ends_at: string | null;
  campaign_id: string | null;
  curator_id: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Atribuição: a view expõe attributed_to='curator:<id>'. Cruzamos com
// (deal.campaign_id + deal.curator_id) para descobrir quais GrowthRow
// pertencem a cada deal. Sem recálculo de delivery — apenas agrupamento.
// ─────────────────────────────────────────────────────────────────────────────
export function attributeDealsToGrowth(
  deals: Deal[],
  rows: GrowthRow[],
): Map<string, GrowthRow[]> {
  const byKey = new Map<string, GrowthRow[]>(); // key = `${campaign_id}::curator:${curator_id}`
  for (const r of rows) {
    if (!r.campaign_id || !r.attributed_to) continue;
    const key = `${r.campaign_id}::${r.attributed_to}`;
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }
  const out = new Map<string, GrowthRow[]>();
  for (const d of deals) {
    if (!d.campaign_id || !d.curator_id) continue;
    const key = `${d.campaign_id}::curator:${d.curator_id}`;
    const arr = byKey.get(key);
    if (arr && arr.length > 0) out.set(d.id, arr);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Total entregue (soma delivery_accumulated já consolidado pela view)
// ─────────────────────────────────────────────────────────────────────────────
export function totalDelivered(rows: GrowthRow[]): number {
  let total = 0;
  for (const r of rows) total += Math.max(0, Number(r.delivery_accumulated ?? 0));
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// Atividade diária (raw CPC): agrupa plays_7d por dia.
// Representa momentum (não delivery) — não há recálculo current-baseline.
// ─────────────────────────────────────────────────────────────────────────────
export function aggregateActivityByDay(rows: CpcRow[]): { day: string; plays: number }[] {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    if (!r.captured_at) continue;
    const day = r.captured_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Math.max(0, Number(r.plays_7d ?? 0)));
  }
  return [...byDay.entries()]
    .map(([day, plays]) => ({ day, plays }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

// ─────────────────────────────────────────────────────────────────────────────
// Top playlists por delivery_accumulated (já consolidado).
// ─────────────────────────────────────────────────────────────────────────────
export function topPlaylistsByDelivery(
  rows: GrowthRow[],
  limit = 10,
): { playlist_id: string; plays_delivered: number; deals_count: number; last_captured_at: string }[] {
  const per = new Map<
    string,
    { plays_delivered: number; curators: Set<string>; last_captured_at: string }
  >();
  for (const r of rows) {
    if (!r.playlist_id) continue;
    const cur = per.get(r.playlist_id) ?? {
      plays_delivered: 0,
      curators: new Set<string>(),
      last_captured_at: "",
    };
    cur.plays_delivered += Math.max(0, Number(r.delivery_accumulated ?? 0));
    if (r.attributed_to) cur.curators.add(r.attributed_to);
    if (r.last_captured_at && r.last_captured_at > cur.last_captured_at) {
      cur.last_captured_at = r.last_captured_at;
    }
    per.set(r.playlist_id, cur);
  }
  return [...per.entries()]
    .map(([playlist_id, v]) => ({
      playlist_id,
      plays_delivered: v.plays_delivered,
      deals_count: v.curators.size,
      last_captured_at: v.last_captured_at,
    }))
    .filter((p) => p.plays_delivered > 0)
    .sort((a, b) => b.plays_delivered - a.plays_delivered)
    .slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Custo por play REAL — usa delivery_accumulated da view por deal.
// ─────────────────────────────────────────────────────────────────────────────
export function realCostPerPlay(
  deals: Deal[],
  dealToGrowth: Map<string, GrowthRow[]>,
): number | null {
  let totalCost = 0;
  let totalPlays = 0;
  for (const d of deals) {
    const rows = dealToGrowth.get(d.id) ?? [];
    const delivered = totalDelivered(rows);
    if (delivered <= 0) continue;
    totalCost += Number(d.cost ?? 0);
    totalPlays += delivered;
  }
  if (totalPlays <= 0) return null;
  return totalCost / totalPlays;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ritmo de um deal — usa delivery_accumulated da view (sem reconstruir
// current - baseline). plays_per_day deriva da janela do deal.
// ─────────────────────────────────────────────────────────────────────────────
export type DealPace = {
  deal: Deal;
  current_plays: number;       // soma de current_plays da view (informativo)
  delivered: number;           // delivery_accumulated agregado pelo view
  target: number;
  plays_per_day: number;
  pace_ratio: number | null;
  tone: "success" | "primary" | "warning" | "danger" | "neutral";
  label: string;
};

export function computeDealPace(deal: Deal, rows: GrowthRow[]): DealPace {
  let current_plays = 0;
  for (const r of rows) current_plays += Math.max(0, Number(r.current_plays ?? 0));
  const delivered = totalDelivered(rows);
  const target = Number(deal.target_plays ?? 0);

  let plays_per_day = 0;
  let pace_ratio: number | null = null;

  const startedAt = deal.started_at ? new Date(deal.started_at).getTime() : null;
  const endsAt = deal.ends_at ? new Date(deal.ends_at).getTime() : null;
  const now = Date.now();

  if (startedAt) {
    const elapsedDays = Math.max(0.5, (now - startedAt) / 86_400_000);
    plays_per_day = delivered / elapsedDays;
    if (endsAt && target > 0) {
      const totalDays = Math.max(0.5, (endsAt - startedAt) / 86_400_000);
      const expectedSoFar = (target / totalDays) * elapsedDays;
      if (expectedSoFar > 0) pace_ratio = delivered / expectedSoFar;
    }
  }

  let tone: DealPace["tone"] = "neutral";
  let label = "—";
  if (pace_ratio != null) {
    if (pace_ratio >= 1.1) { tone = "success"; label = "Adiantado"; }
    else if (pace_ratio >= 0.9) { tone = "primary"; label = "No ritmo"; }
    else if (pace_ratio >= 0.6) { tone = "warning"; label = "Lento"; }
    else { tone = "danger"; label = "Crítico"; }
  }

  return { deal, current_plays, delivered, target, plays_per_day, pace_ratio, tone, label };
}

export function isoSinceDays(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
