// dealsAnalytics — helpers puros pro /analytics.
// Lê APENAS do motor vivo: curator_deals, curator_deal_snapshots, curator_deal_logs.
//
// Modelo:
//   curator_deal_snapshots: (deal_id, playlist_id, plays, captured_at) — cumulativo
//   curator_deal_logs:      (deal_id, total_plays, created_at) — log de coleta deal-level
//   curator_deals:          (id, state, target_plays, baseline_plays, cost, started_at, ends_at, song_artist, song_name)

export type Snapshot = {
  deal_id: string;
  playlist_id: string | null;
  plays: number;
  captured_at: string;
};

export type DealLog = {
  id: string;
  deal_id: string;
  total_plays: number;
  created_at: string;
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
};

// ─────────────────────────────────────────────────────────────────────────────
// Plays entregues numa janela (delta entre primeiro e último snapshot por playlist)
// ─────────────────────────────────────────────────────────────────────────────
export function playsDeliveredInWindow(snapshots: Snapshot[]): number {
  // Agrupa por (deal, playlist) e soma (último - primeiro)
  const grouped = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    if (!s.playlist_id) continue;
    const k = `${s.deal_id}::${s.playlist_id}`;
    const arr = grouped.get(k) ?? [];
    arr.push(s);
    grouped.set(k, arr);
  }
  let total = 0;
  for (const arr of grouped.values()) {
    arr.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
    const delta = (arr[arr.length - 1].plays ?? 0) - (arr[0].plays ?? 0);
    if (delta > 0) total += delta;
  }
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entregas por dia (delta acumulado de plays no dia, somando todos os pares)
// ─────────────────────────────────────────────────────────────────────────────
export function aggregateDeliveriesByDay(snapshots: Snapshot[]): { day: string; plays: number }[] {
  // Por (deal, playlist) calcula delta entre snapshots consecutivos e atribui ao dia do segundo.
  const grouped = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    if (!s.playlist_id) continue;
    const k = `${s.deal_id}::${s.playlist_id}`;
    const arr = grouped.get(k) ?? [];
    arr.push(s);
    grouped.set(k, arr);
  }
  const byDay = new Map<string, number>();
  for (const arr of grouped.values()) {
    arr.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
    for (let i = 1; i < arr.length; i++) {
      const delta = (arr[i].plays ?? 0) - (arr[i - 1].plays ?? 0);
      if (delta <= 0) continue;
      const day = arr[i].captured_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + delta);
    }
  }
  return [...byDay.entries()]
    .map(([day, plays]) => ({ day, plays }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

// ─────────────────────────────────────────────────────────────────────────────
// Top playlists por delta de plays na janela
// ─────────────────────────────────────────────────────────────────────────────
export function topPlaylistsByDelta(
  snapshots: Snapshot[],
  limit = 10,
): { playlist_id: string; plays_delivered: number; deals_count: number; last_captured_at: string }[] {
  const grouped = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    if (!s.playlist_id) continue;
    const k = `${s.deal_id}::${s.playlist_id}`;
    const arr = grouped.get(k) ?? [];
    arr.push(s);
    grouped.set(k, arr);
  }
  // Agrega por playlist
  const perPlaylist = new Map<
    string,
    { plays_delivered: number; deals: Set<string>; last_captured_at: string }
  >();
  for (const [k, arr] of grouped) {
    arr.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
    const delta = (arr[arr.length - 1].plays ?? 0) - (arr[0].plays ?? 0);
    if (delta <= 0) continue;
    const [dealId, playlistId] = k.split("::");
    const cur = perPlaylist.get(playlistId) ?? {
      plays_delivered: 0,
      deals: new Set<string>(),
      last_captured_at: "",
    };
    cur.plays_delivered += delta;
    cur.deals.add(dealId);
    const last = arr[arr.length - 1].captured_at;
    if (last > cur.last_captured_at) cur.last_captured_at = last;
    perPlaylist.set(playlistId, cur);
  }
  return [...perPlaylist.entries()]
    .map(([playlist_id, v]) => ({
      playlist_id,
      plays_delivered: v.plays_delivered,
      deals_count: v.deals.size,
      last_captured_at: v.last_captured_at,
    }))
    .sort((a, b) => b.plays_delivered - a.plays_delivered)
    .slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Custo por play REAL = soma(cost dos deals com entrega) / soma(plays entregues)
// ─────────────────────────────────────────────────────────────────────────────
export function realCostPerPlay(deals: Deal[], snapshots: Snapshot[]): number | null {
  const deliveryByDeal = new Map<string, number>();
  const grouped = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    if (!s.playlist_id) continue;
    const k = `${s.deal_id}::${s.playlist_id}`;
    const arr = grouped.get(k) ?? [];
    arr.push(s);
    grouped.set(k, arr);
  }
  for (const [k, arr] of grouped) {
    arr.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
    const delta = (arr[arr.length - 1].plays ?? 0) - (arr[0].plays ?? 0);
    if (delta <= 0) continue;
    const dealId = k.split("::")[0];
    deliveryByDeal.set(dealId, (deliveryByDeal.get(dealId) ?? 0) + delta);
  }
  let totalCost = 0;
  let totalPlays = 0;
  for (const d of deals) {
    const delivered = deliveryByDeal.get(d.id) ?? 0;
    if (delivered <= 0) continue;
    totalCost += Number(d.cost ?? 0);
    totalPlays += delivered;
  }
  if (totalPlays <= 0) return null;
  return totalCost / totalPlays;
}

// ─────────────────────────────────────────────────────────────────────────────
// Velocidade / ritmo de um deal ativo
// ─────────────────────────────────────────────────────────────────────────────
export type DealPace = {
  deal: Deal;
  current_plays: number;
  delivered: number;          // current - baseline
  target: number;
  plays_per_day: number;
  pace_ratio: number | null;  // real/esperado; null se janela inválida
  tone: "success" | "primary" | "warning" | "danger" | "neutral";
  label: string;
};

export function computeDealPace(deal: Deal, snapshots: Snapshot[]): DealPace {
  // Soma os últimos snapshots por playlist (max plays por playlist do deal)
  const lastByPlaylist = new Map<string, Snapshot>();
  const firstByPlaylist = new Map<string, Snapshot>();
  for (const s of snapshots) {
    if (s.deal_id !== deal.id || !s.playlist_id) continue;
    const last = lastByPlaylist.get(s.playlist_id);
    if (!last || s.captured_at > last.captured_at) lastByPlaylist.set(s.playlist_id, s);
    const first = firstByPlaylist.get(s.playlist_id);
    if (!first || s.captured_at < first.captured_at) firstByPlaylist.set(s.playlist_id, s);
  }
  let current_plays = 0;
  for (const s of lastByPlaylist.values()) current_plays += s.plays ?? 0;

  const baseline = Number(deal.baseline_plays ?? 0);
  const target = Number(deal.target_plays ?? 0);
  const delivered = Math.max(0, current_plays - baseline);

  // Calcula plays/dia com base nos snapshots: total delta / dias da janela
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
