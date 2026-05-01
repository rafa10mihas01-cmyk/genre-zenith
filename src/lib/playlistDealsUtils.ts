// Pure utility for Playlist Deals stats computation.
// Mantém-se sem efeitos colaterais para facilitar testes e reuso na UI.

export type PlaylistDeal = {
  id: string;
  user_id: string;
  song: string;
  playlist: string;
  curator: string | null;
  spotify_url: string | null;
  target: number;
  start_plays: number;
  cost: number | null;
  created_at: string;
};

export type PlaylistDealLog = {
  id: string;
  deal_id: string;
  count: number;
  note: string | null;
  created_at: string;
};

export type DealStats = {
  earned: number;
  pct: number;
  vel: number | null;
  eta: number | null;
  latestCount: number;
  dealLogs: PlaylistDealLog[];
};

export function computeStats(deal: PlaylistDeal, logs: PlaylistDealLog[]): DealStats {
  const dealLogs = logs
    .filter((l) => l.deal_id === deal.id)
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const startPlays = Number(deal.start_plays ?? 0);
  const target = Number(deal.target ?? 0);

  const latestCount = dealLogs.length > 0
    ? Number(dealLogs[dealLogs.length - 1].count)
    : startPlays;

  const earned = Math.max(0, latestCount - startPlays);
  const pct = target > 0 ? Math.min(100, Math.round((earned / target) * 100)) : 0;

  let vel: number | null = null;
  if (dealLogs.length >= 2) {
    const first = dealLogs[0];
    const last = dealLogs[dealLogs.length - 1];
    const days =
      (new Date(last.created_at).getTime() - new Date(first.created_at).getTime()) /
      (1000 * 60 * 60 * 24);
    const delta = Number(last.count) - Number(first.count);
    if (days > 0 && delta > 0) {
      vel = delta / days;
    }
  }

  let eta: number | null = null;
  if (earned >= target && target > 0) {
    eta = 0;
  } else if (vel && vel > 0) {
    const remaining = Math.max(0, target - earned);
    eta = Math.ceil(remaining / vel);
  }

  return { earned, pct, vel, eta, latestCount, dealLogs };
}
