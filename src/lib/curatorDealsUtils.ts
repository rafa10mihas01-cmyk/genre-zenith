// Pure utility for Curator Deals stats computation. Sem efeitos colaterais.

export type CuratorDeal = {
  id: string;
  user_id: string;
  curator_name: string;
  song_spotify_url: string;
  song_name: string;
  song_artist: string | null;
  song_cover_url: string | null;
  target_plays: number;
  daily_goal: number;
  baseline_plays: number;
  cost: number | null;
  started_at: string;
  public_token: string;
  created_at: string;
};

export type CuratorPlaylist = {
  id: string;
  deal_id: string;
  spotify_url: string;
  playlist_name: string;
  followers: number | null;
  is_baseline: boolean;
  added_at: string;
};

export type CuratorDealLog = {
  id: string;
  deal_id: string;
  total_plays: number;
  note: string | null;
  is_baseline: boolean;
  created_at: string;
  print_urls?: string[] | null;
};

export type CuratorDealStats = {
  earned: number;
  pct: number;
  vel: number | null;
  eta: number | null;
  latestPlays: number;
  hasBaseline: boolean;
  newPlaylists: CuratorPlaylist[];
  baselinePlaylists: CuratorPlaylist[];
  dealLogs: CuratorDealLog[];
  nonBaselineLogs: CuratorDealLog[];
};

export function computeCuratorStats(
  deal: CuratorDeal,
  logs: CuratorDealLog[],
  playlists: CuratorPlaylist[],
): CuratorDealStats {
  const dealLogs = logs
    .filter((l) => l.deal_id === deal.id)
    .slice()
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

  const baseline = Number(deal.baseline_plays ?? 0);
  const target = Number(deal.target_plays ?? 0);

  const nonBaselineLogs = dealLogs.filter((l) => !l.is_baseline);
  const hasBaseline = dealLogs.some((l) => l.is_baseline);

  const latestPlays =
    nonBaselineLogs.length > 0
      ? Number(nonBaselineLogs[nonBaselineLogs.length - 1].total_plays)
      : baseline;

  const earned =
    nonBaselineLogs.length > 0 ? Math.max(0, latestPlays - baseline) : 0;

  const pct =
    target > 0 ? Math.min(100, Math.round((earned / target) * 100)) : 0;

  let vel: number | null = null;
  if (nonBaselineLogs.length >= 2) {
    const first = nonBaselineLogs[0];
    const last = nonBaselineLogs[nonBaselineLogs.length - 1];
    const days =
      (new Date(last.created_at).getTime() -
        new Date(first.created_at).getTime()) /
      (1000 * 60 * 60 * 24);
    const delta = Number(last.total_plays) - Number(first.total_plays);
    if (days > 0 && delta > 0) {
      vel = delta / days;
    }
  }

  let eta: number | null = null;
  if (target > 0 && earned >= target) {
    eta = 0;
  } else if (vel && vel > 0) {
    const remaining = Math.max(0, target - earned);
    eta = Math.ceil(remaining / vel);
  }

  const dealPlaylists = playlists.filter((p) => p.deal_id === deal.id);
  const newPlaylists = dealPlaylists.filter((p) => !p.is_baseline);
  const baselinePlaylists = dealPlaylists.filter((p) => p.is_baseline);

  return {
    earned,
    pct,
    vel,
    eta,
    latestPlays,
    hasBaseline,
    newPlaylists,
    baselinePlaylists,
    dealLogs,
    nonBaselineLogs,
  };
}
