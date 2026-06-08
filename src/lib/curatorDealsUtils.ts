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
  baseline_plays: number | null;
  baseline_captured_at?: string | null;
  cost: number | null;
  started_at: string;
  ends_at: string | null;
  public_token: string;
  client_token?: string | null;
  slug?: string | null;
  created_at: string;
  closed_at?: string | null;
  closed_status?: "completed" | "cancelled" | null;
  closed_reason?: string | null;
  final_report_url?: string | null;
  campaign_id?: string | null;
  origin?: "campaign" | "manual" | null;
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
  auto_collect?: boolean;
  auto_collect_status?: "idle" | "queued" | "error" | "done" | string;
  auto_collect_interval_minutes?: number;
  auto_collect_error?: string | null;
  next_auto_collect_at?: string | null;
  last_auto_collect_at?: string | null;
  last_print_at?: string | null;
  client_id?: string | null;
  client_token?: string | null;
  slug?: string | null;
  smartlink_url?: string | null;
};

export type CuratorMatchStatus =
  | "curator"
  | "baseline"
  | "editorial"
  | "algorithmic"
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
  song_id?: string | null;
  // Campos UI-only preenchidos por dedupeCuratorPlaylists
  song_ids?: string[];
  song_names?: string[];
  duplicate_count?: number;
};

/**
 * Deduplicates curator_playlists rows that represent the SAME playlist
 * (Spotify-side) but were inserted multiple times — one per song — by
 * an old version of the paste flow. Identity preference:
 *   1) spotify_playlist_id
 *   2) spotify_url
 *   3) deal_id + lowercased playlist_name
 *
 * Mantém a linha mais antiga (added_at) como representante e agrega
 * song_ids / song_names + max(streams_*) das duplicatas.
 */
export function dedupeCuratorPlaylists(
  playlists: CuratorPlaylist[],
  songs: { id: string; song_name: string }[] = [],
): CuratorPlaylist[] {
  const songMap = new Map(songs.map((s) => [s.id, s.song_name] as const));
  const buckets = new Map<string, CuratorPlaylist[]>();

  for (const p of playlists) {
    const key =
      (p.spotify_playlist_id && `pid:${p.spotify_playlist_id}`) ||
      (p.spotify_url && `url:${p.spotify_url.trim().toLowerCase()}`) ||
      `name:${p.deal_id}:${(p.playlist_name ?? "").trim().toLowerCase()}`;
    const arr = buckets.get(key) ?? [];
    arr.push(p);
    buckets.set(key, arr);
  }

  const out: CuratorPlaylist[] = [];
  for (const group of buckets.values()) {
    const sorted = group
      .slice()
      .sort((a, b) => new Date(a.added_at).getTime() - new Date(b.added_at).getTime());
    const head = sorted[0];
    const song_ids = Array.from(
      new Set(sorted.map((g) => g.song_id ?? null).filter((x): x is string => !!x)),
    );
    const song_names = song_ids
      .map((id) => songMap.get(id))
      .filter((x): x is string => !!x);
    const maxNum = (key: keyof CuratorPlaylist) =>
      sorted.reduce((m, g) => {
        const v = Number(g[key] ?? 0);
        return Number.isFinite(v) && v > m ? v : m;
      }, 0);
    out.push({
      ...head,
      streams_7d: maxNum("streams_7d") || head.streams_7d || null,
      streams_28d: maxNum("streams_28d") || head.streams_28d || null,
      streams_total: maxNum("streams_total") || head.streams_total || null,
      song_ids,
      song_names,
      duplicate_count: sorted.length,
    });
  }

  // Mantém ordem original do primeiro aparecimento
  const firstIndex = new Map<string, number>();
  playlists.forEach((p, i) => {
    const key =
      (p.spotify_playlist_id && `pid:${p.spotify_playlist_id}`) ||
      (p.spotify_url && `url:${p.spotify_url.trim().toLowerCase()}`) ||
      `name:${p.deal_id}:${(p.playlist_name ?? "").trim().toLowerCase()}`;
    if (!firstIndex.has(key)) firstIndex.set(key, i);
  });
  out.sort((a, b) => {
    const ka =
      (a.spotify_playlist_id && `pid:${a.spotify_playlist_id}`) ||
      (a.spotify_url && `url:${a.spotify_url.trim().toLowerCase()}`) ||
      `name:${a.deal_id}:${(a.playlist_name ?? "").trim().toLowerCase()}`;
    const kb =
      (b.spotify_playlist_id && `pid:${b.spotify_playlist_id}`) ||
      (b.spotify_url && `url:${b.spotify_url.trim().toLowerCase()}`) ||
      `name:${b.deal_id}:${(b.playlist_name ?? "").trim().toLowerCase()}`;
    return (firstIndex.get(ka) ?? 0) - (firstIndex.get(kb) ?? 0);
  });
  return out;
}

export type CuratorDealLog = {
  id: string;
  deal_id: string;
  song_id?: string | null;
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

// Override vindo da RPC `get_curator_deal_progress` — fonte oficial de
// `earned/pct/latestPlays/vel/eta` quando há snapshots. Quando passado,
// sobrescreve o cálculo legado (que ainda existe pra rodar offline/sem snapshots).
export type CuratorDealProgress = {
  baseline_total?: number | null;
  latest_total?: number | null;
  delivered_curator?: number | null;
  delivered_total?: number | null;
  daily_avg?: number | null;
  progress_pct?: number | null;
  eta_days?: number | null;
  target_plays?: number | null;
  /** Entrega de hoje (delta últimas 24h ou daily_avg como aproximação). */
  today_plays?: number | null;
};

export function computeCuratorStats(
  deal: CuratorDeal,
  logs: CuratorDealLog[],
  playlists: CuratorPlaylist[],
  progressOverride?: CuratorDealProgress | null,
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
  const hasBaseline = !!deal.baseline_captured_at || dealLogs.some((l) => l.is_baseline);

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
    else if (status === "curator" || status === "organic" || status === "editorial" || status === "algorithmic") legitCount++;
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

  // === Override do RPC (fonte oficial: snapshots) ===
  // Se a página passou progressOverride, sobrescrevemos earned/pct/latestPlays/vel/eta.
  // Mantemos qualidade (legitShare/suspiciousShare/onTime/score) calculados localmente
  // a partir das playlists (snapshots não classificam fonte).
  let earnedFinal = earned;
  let pctFinal = pct;
  let latestPlaysFinal = latestPlays;
  let velFinal = vel;
  let etaFinal = eta;
  let todayPlaysFinal = todayPlays;
  if (progressOverride) {
    const delivered = Number(progressOverride.delivered_curator ?? 0);
    const latestRaw = progressOverride.latest_total;
    const latest = latestRaw == null ? NaN : Number(latestRaw);
    const dailyAvg = Number(progressOverride.daily_avg ?? 0);
    const pctRpc = progressOverride.progress_pct;
    const etaRpc = progressOverride.eta_days;
    earnedFinal = Math.max(0, delivered);
    latestPlaysFinal = Number.isFinite(latest) ? Math.max(0, latest) : latestPlays;
    pctFinal = pctRpc != null ? Math.min(100, Math.round(Number(pctRpc))) :
      (target > 0 ? Math.min(100, Math.round((earnedFinal / target) * 100)) : 0);
    velFinal = dailyAvg > 0 ? dailyAvg : null;
    etaFinal = etaRpc != null ? Number(etaRpc) : (
      target > 0 && earnedFinal >= target ? 0 :
      (velFinal && velFinal > 0 ? Math.ceil(Math.max(0, target - earnedFinal) / velFinal) : null)
    );
    // Hoje: usa override quando informado; fallback pra daily_avg (entrega média diária)
    // pra evitar mostrar "0%" quando há entrega real mas sem logs manuais.
    const todayOverride = progressOverride.today_plays;
    if (todayOverride != null && Number.isFinite(Number(todayOverride))) {
      todayPlaysFinal = Math.max(0, Math.round(Number(todayOverride)));
    } else if (todayPlays === 0 && dailyAvg > 0) {
      todayPlaysFinal = Math.round(dailyAvg);
    }
  }

  const todayPctFinal =
    dailyGoal > 0 ? Math.min(100, Math.round((todayPlaysFinal / dailyGoal) * 100)) : 0;


  return {
    earned: earnedFinal,
    pct: pctFinal,
    vel: velFinal,
    eta: etaFinal,
    latestPlays: latestPlaysFinal,
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
