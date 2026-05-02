// Pure utility for Curator Deals stats computation. Sem efeitos colaterais.

export type CuratorDeal = {
  id: string;
  user_id: string;
  curator_id?: string | null;
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
  ends_at: string | null;
  public_token: string;
  slug?: string | null;
  created_at: string;
  closed_at?: string | null;
  closed_status?: "completed" | "cancelled" | null;
  closed_reason?: string | null;
  final_report_url?: string | null;
};

export type CuratorDealSong = {
  id: string;
  deal_id: string;
  song_spotify_url: string;
  spotify_track_id: string | null;
  song_name: string;
  song_artist: string | null;
  song_cover_url: string | null;
  daily_goal: number;
  target_plays: number | null;
  baseline_plays: number;
  position: number;
  started_at?: string | null;
  ends_at?: string | null;
  ramp_up_days?: number;
  created_at: string;
  updated_at: string;
};

export type CuratorMatchStatus =
  | "curator"
  | "baseline"
  | "editorial"
  | "suspicious"
  | "organic";

export type CuratorPlaylist = {
  id: string;
  deal_id: string;
  spotify_url: string;
  playlist_name: string;
  followers: number | null;
  is_baseline: boolean;
  added_at: string;
  // Campos do fluxo de paste/enriquecimento (podem vir nulos em registros antigos)
  spotify_playlist_id?: string | null;
  spotify_owner_id?: string | null;
  spotify_owner_name?: string | null;
  image_url?: string | null;
  added_at_spotify?: string | null;
  match_status?: CuratorMatchStatus | null;
  match_reason?: string | null;
  streams_7d?: number | null;
  streams_28d?: number | null;
  streams_total?: number | null;
  last_paste_at?: string | null;
  position_in_paste?: number | null;
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
  todayPlays: number;
  todayPct: number;
  hasBaseline: boolean;
  newPlaylists: CuratorPlaylist[];
  baselinePlaylists: CuratorPlaylist[];
  dealLogs: CuratorDealLog[];
  nonBaselineLogs: CuratorDealLog[];
  // Fase 4 — qualidade e score
  legitShare: number;       // 0..1 — (curator+organic+editorial) / (todas exceto baseline)
  suspiciousShare: number;  // 0..1
  onTime: boolean | null;   // true=bateu meta antes/em ends_at, false=passou, null=indef
  score: number;            // 0..100 (prazo + share legítimo)
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

  // todayPlays = ganho desde o último registro de OUTRO dia (ou baseline).
  // Útil pra mostrar "hoje x / combinado_diário".
  let todayPlays = 0;
  if (nonBaselineLogs.length > 0) {
    const todayKey = new Date().toISOString().slice(0, 10);
    const lastBefore = [...dealLogs]
      .reverse()
      .find((l) => l.created_at.slice(0, 10) !== todayKey);
    const lastBeforeVal = lastBefore ? Number(lastBefore.total_plays) : baseline;
    todayPlays = Math.max(0, latestPlays - lastBeforeVal);
  }
  const dailyGoal = Number((deal as unknown as { daily_goal?: number }).daily_goal ?? 0);
  const todayPct =
    dailyGoal > 0 ? Math.min(100, Math.round((todayPlays / dailyGoal) * 100)) : 0;

  // === Fase 4: qualidade do tráfego ===
  // Considera só playlists não-baseline (entregas reais).
  const realPlaylists = newPlaylists;
  const totalReal = realPlaylists.length;
  let legitCount = 0;
  let suspiciousCount = 0;
  for (const p of realPlaylists) {
    const status = (p.match_status ?? "curator") as CuratorMatchStatus;
    if (status === "suspicious") suspiciousCount++;
    else if (status === "curator" || status === "organic" || status === "editorial") legitCount++;
  }
  const legitShare = totalReal > 0 ? legitCount / totalReal : 1; // sem entregas ainda → assume 100%
  const suspiciousShare = totalReal > 0 ? suspiciousCount / totalReal : 0;

  // === Prazo cumprido ===
  // onTime: bateu meta dentro de ends_at? (precisa earned>=target E último log <= ends_at)
  let onTime: boolean | null = null;
  if (target > 0 && deal.ends_at) {
    const endsMs = new Date(deal.ends_at).getTime();
    const reachedTarget = earned >= target;
    if (reachedTarget) {
      // pegamos o primeiro log onde acumulado >= target
      const lastLog = nonBaselineLogs[nonBaselineLogs.length - 1];
      const reachedAt = lastLog ? new Date(lastLog.created_at).getTime() : Date.now();
      onTime = reachedAt <= endsMs;
    } else {
      // ainda não bateu — se já passou do prazo, é false; senão indefinido
      onTime = Date.now() <= endsMs ? null : false;
    }
  }

  // === Score 0..100 ===
  // 60% prazo cumprido + 40% share legítimo
  // - prazo: onTime true=100, null=70 (em andamento), false=20
  // - legit: legitShare * 100, com penalidade dura se suspiciousShare > 0.3
  const prazoScore = onTime === true ? 100 : onTime === false ? 20 : 70;
  let legitScore = legitShare * 100;
  if (suspiciousShare >= 0.3) legitScore = Math.min(legitScore, 40);
  const score = Math.round(prazoScore * 0.6 + legitScore * 0.4);

  return {
    earned,
    pct,
    vel,
    eta,
    latestPlays,
    todayPlays,
    todayPct,
    hasBaseline,
    newPlaylists,
    baselinePlaylists,
    dealLogs,
    nonBaselineLogs,
    legitShare,
    suspiciousShare,
    onTime,
    score,
  };
}
