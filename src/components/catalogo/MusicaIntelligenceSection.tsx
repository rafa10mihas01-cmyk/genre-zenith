// MusicaIntelligenceSection
// Aba "Inteligência" do detalhe de uma música do catálogo.
// 6 painéis Enterprise construídos 100% sobre dados que já existem:
//   1. Timeline (cadastro → baseline → placements → picos → última coleta)
//   2. Histórico de distribuição (entradas/saídas/saldo por dia)
//   3. Saúde operacional (worker, VPS, fila, breaker, último erro)
//   4. Ranking de playlists (entrega, retenção, melhor pos, tempo até detectar)
//   5. Linha do tempo de cada placement (POST → confirmado → detectado → removido)
//   6. Feed de eventos cronológico
//
// Não chama nenhuma edge function. Nenhuma nova tabela. Nenhuma nova coleta.
import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Award,
  CheckCircle2, ChevronDown, Clock, ExternalLink, GitBranch,
  History, ListMusic, Server, Sparkles, TrendingUp, Zap,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useCatalogTrackIntelligence,
  type ExecutionLogRow,
  type ObserverTrackRow,
  type SongSnapPlaylistRow,
} from "@/hooks/useCatalogTrackIntelligence";

// ------- tipos vindos do detalhe (sem reimportar) -------
type Track = { id: string; spotify_track_id: string; track_name: string; added_at: string };
type Baseline = { captured_at: string; streams: number | null } | null;
type Telemetry = {
  baseline_at: string | null;
  last_captured_at: string | null;
  last_plays_28d: number | null;
  growth_abs: number | null;
  growth_pct: number | null;
  playlists_present_count: number;
  snapshots_count: number;
} | null;
type Placement = {
  id: string;
  status: string;
  added_at: string | null;
  scheduled_for: string;
  last_error_code: string | null;
  managed_playlists: { name: string; spotify_playlist_id: string | null; followers: number | null } | null;
};
type Snapshot = { id: string; captured_at: string; total_plays_28d: number | null };
type Queue = { status: string; scheduled_for: string; attempts: number; max_attempts: number; last_error: string | null; locked_at: string | null } | null;

export type MusicaIntelligenceProps = {
  track: Track;
  baseline: Baseline;
  telemetry: Telemetry;
  placements: Placement[];
  snapshots: Snapshot[];
  queue: Queue;
};

const fmt = (n: number | null | undefined) =>
  typeof n === "number" ? n.toLocaleString("pt-BR") : "—";
const dt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const d = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
const rel = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
};
const dayKey = (iso: string) => iso.slice(0, 10);

// ============================================================
// Card / Section wrappers — visual coeso com o restante da página
// ============================================================
function Panel({ title, hint, icon: Icon, children, defaultOpen = true }: {
  title: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground text-left truncate">{title}</h3>
            {hint && <p className="text-[11px] text-muted-foreground text-left truncate">{hint}</p>}
          </div>
        </div>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform shrink-0", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </section>
  );
}

// ============================================================
// 1) TIMELINE
// ============================================================
type TimelineEvent = {
  at: string;
  kind: "cadastro" | "baseline" | "placement_post" | "playlist_in" | "playlist_out" | "snapshot" | "peak" | "last" | "breaker";
  label: string;
  detail?: string;
  tone?: "good" | "warn" | "bad" | "neutral" | "highlight";
};

function buildTimeline(
  track: Track,
  baseline: Baseline,
  placements: Placement[],
  snapshots: Snapshot[],
  exec: ExecutionLogRow[],
  obs: ObserverTrackRow[],
  telemetry: Telemetry,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  events.push({
    at: track.added_at,
    kind: "cadastro",
    label: "Música cadastrada no catálogo",
    tone: "highlight",
  });

  if (baseline?.captured_at) {
    events.push({
      at: baseline.captured_at,
      kind: "baseline",
      label: "Baseline T0 capturada",
      detail: baseline.streams != null ? `${fmt(baseline.streams)} streams` : undefined,
      tone: "good",
    });
  }

  // Primeira playlist (primeira detecção VPS global) — apenas o marco
  const firstObsGlobal = obs[0];
  if (firstObsGlobal) {
    events.push({
      at: firstObsGlobal.captured_at,
      kind: "playlist_in",
      label: "Primeira playlist",
      detail: namePlaylist(placements, firstObsGlobal.spotify_playlist_id) ?? firstObsGlobal.spotify_playlist_id,
      tone: "good",
    });
  }


  // Snapshots — só pico e última, pra não poluir
  let peak: Snapshot | null = null;
  snapshots.forEach((s) => {
    if (!peak || (s.total_plays_28d ?? 0) > (peak.total_plays_28d ?? 0)) peak = s;
  });
  if (peak && (peak.total_plays_28d ?? 0) > 0) {
    events.push({
      at: peak.captured_at,
      kind: "peak",
      label: "Maior pico de Streams 28D",
      detail: `${fmt(peak.total_plays_28d)} streams`,
      tone: "highlight",
    });
  }
  const last = snapshots.at(-1);
  if (last && last !== peak) {
    events.push({
      at: last.captured_at,
      kind: "last",
      label: "Última coleta",
      detail: telemetry?.last_plays_28d != null ? `${fmt(telemetry.last_plays_28d)} streams 28d` : `${fmt(last.total_plays_28d)} streams`,
      tone: "neutral",
    });
  }

  return events.sort((a, b) => +new Date(a.at) - +new Date(b.at));
}

function namePlaylist(placements: Placement[], spotifyPlaylistId?: string | null) {
  if (!spotifyPlaylistId) return null;
  const p = placements.find((p) => p.managed_playlists?.spotify_playlist_id === spotifyPlaylistId);
  return p?.managed_playlists?.name ?? null;
}

function TimelinePanel(props: MusicaIntelligenceProps & { exec: ExecutionLogRow[]; obs: ObserverTrackRow[] }) {
  const events = useMemo(
    () => buildTimeline(props.track, props.baseline, props.placements, props.snapshots, props.exec, props.obs, props.telemetry),
    [props.track, props.baseline, props.placements, props.snapshots, props.exec, props.obs, props.telemetry],
  );
  if (events.length === 0) {
    return <div className="p-6 text-center text-xs text-muted-foreground">Sem eventos ainda.</div>;
  }
  return (
    <ol className="relative px-4 sm:px-6 py-5 space-y-3">
      <span className="absolute left-[22px] sm:left-[30px] top-5 bottom-5 w-px bg-border" />
      {events.map((e, i) => (
        <li key={`${e.at}-${i}`} className="relative pl-7 sm:pl-9">
          <span
            className={cn(
              "absolute left-0 sm:left-2 top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-card",
              e.tone === "good" && "bg-emerald-500",
              e.tone === "warn" && "bg-amber-500",
              e.tone === "bad" && "bg-rose-500",
              e.tone === "highlight" && "bg-[#1DB954]",
              (!e.tone || e.tone === "neutral") && "bg-muted-foreground/60",
            )}
          />
          <div className="text-[11px] font-mono text-muted-foreground tabular-nums">{dt(e.at)}</div>
          <div className="text-sm font-medium text-foreground">{e.label}</div>
          {e.detail && <div className="text-xs text-muted-foreground truncate">{e.detail}</div>}
        </li>
      ))}
    </ol>
  );
}

// ============================================================
// 2) HISTÓRICO DE DISTRIBUIÇÃO (entradas/saídas/saldo por dia)
// ============================================================
function DistributionHistoryPanel({ placements, exec }: { placements: Placement[]; exec: ExecutionLogRow[] }) {
  // Entrada: placement.added_at  ·  Saída inferida: lastSeen muito antigo OU status=removed
  const days = useMemo(() => {
    const map = new Map<string, { in: number; out: number; total: number }>();
    // entradas
    placements.forEach((p) => {
      if (!p.added_at) return;
      const k = dayKey(p.added_at);
      const row = map.get(k) ?? { in: 0, out: 0, total: 0 };
      row.in += 1;
      map.set(k, row);
    });
    // saídas — placements removed (sem column removed_at aqui, usa updated_at via exec não disponível;
    // como fallback usa execution_log com outcome=removed se existir)
    exec.forEach((e) => {
      if (e.outcome === "removed" || e.outcome === "placement_removed") {
        const k = dayKey(e.executed_at);
        const row = map.get(k) ?? { in: 0, out: 0, total: 0 };
        row.out += 1;
        map.set(k, row);
      }
    });
    const arr = [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    let running = 0;
    arr.forEach(([, v]) => {
      running += v.in - v.out;
      v.total = running;
    });
    return arr;
  }, [placements, exec]);

  if (days.length === 0) {
    return <div className="p-6 text-center text-xs text-muted-foreground">Sem histórico ainda.</div>;
  }

  const maxBar = Math.max(1, ...days.map(([, v]) => Math.max(v.in, v.out)));

  return (
    <div className="p-4 sm:p-5 space-y-3">
      <div className="grid grid-cols-[80px_1fr_60px_60px_70px] sm:grid-cols-[110px_1fr_70px_70px_90px] gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium pb-2 border-b border-border">
        <div>Dia</div>
        <div>Saldo / barras</div>
        <div className="text-right">Entr.</div>
        <div className="text-right">Saíd.</div>
        <div className="text-right">Total</div>
      </div>
      <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
        {days.map(([day, v]) => (
          <div key={day} className="grid grid-cols-[80px_1fr_60px_60px_70px] sm:grid-cols-[110px_1fr_70px_70px_90px] gap-2 items-center text-xs">
            <div className="text-muted-foreground font-mono">{d(day)}</div>
            <div className="h-3 flex items-center gap-[2px]">
              <div className="h-full bg-emerald-500/70 rounded-sm" style={{ width: `${(v.in / maxBar) * 50}%` }} />
              <div className="h-full bg-rose-500/70 rounded-sm" style={{ width: `${(v.out / maxBar) * 50}%` }} />
            </div>
            <div className="text-right font-mono tabular-nums text-emerald-400">+{v.in}</div>
            <div className="text-right font-mono tabular-nums text-rose-400">-{v.out}</div>
            <div className="text-right font-mono tabular-nums font-semibold text-foreground">{v.total}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 3) SAÚDE OPERACIONAL
// ============================================================
function OperationalHealthPanel(props: MusicaIntelligenceProps & {
  exec: ExecutionLogRow[];
  breakers: { app_id: string; status: string; blocked_until: string | null }[];
  vps: { spotify_playlist_id: string; vps_label: string | null }[];
}) {
  const { queue, telemetry, exec, breakers, vps } = props;
  const lastErr = exec.find((e) => e.outcome !== "spotify_post_ok" && e.outcome !== "already_present");
  const lastExec = exec[0];
  const openBreakers = breakers.filter((b) => b.status === "open");
  const vpsCount = new Set(vps.map((v) => v.vps_label).filter(Boolean)).size;
  const queueActive = queue && (queue.status === "pending" || queue.status === "processing" || queue.status === "retry");

  const rows: Array<{ label: string; value: React.ReactNode; tone?: "good" | "warn" | "bad" }> = [
    { label: "Última coleta", value: rel(telemetry?.last_captured_at) },
    { label: "Próxima coleta", value: queue?.scheduled_for ? dt(queue.scheduled_for) : "—" },
    { label: "Worker responsável", value: queue?.locked_at ? <span className="font-mono">claimed @ {dt(queue.locked_at)}</span> : "—" },
    { label: "VPS na rota", value: vpsCount ? `${vpsCount} nó(s)` : "—" },
    { label: "Status da fila", value: queue?.status ?? "—", tone: queue?.status === "failed" ? "bad" : queueActive ? "warn" : "good" },
    { label: "Tentativas", value: queue ? `${queue.attempts}/${queue.max_attempts}` : "—" },
    { label: "Snapshots totais", value: fmt(telemetry?.snapshots_count) },
    { label: "Última execução (POST)", value: lastExec ? `${lastExec.outcome} · ${rel(lastExec.executed_at)}` : "—" },
    { label: "Último erro", value: lastErr ? `${lastErr.outcome}${lastErr.error_code ? ` (${lastErr.error_code})` : ""} · ${rel(lastErr.executed_at)}` : "—", tone: lastErr ? "warn" : "good" },
    {
      label: "Circuit breaker",
      value: openBreakers.length
        ? `${openBreakers.length} app(s) bloqueado(s)${openBreakers[0]?.blocked_until ? ` até ${dt(openBreakers[0].blocked_until)}` : ""}`
        : "Tudo livre",
      tone: openBreakers.length ? "warn" : "good",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
      {[0, 1].map((col) => (
        <ul key={col} className="divide-y divide-border">
          {rows
            .filter((_, i) => i % 2 === col)
            .map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="text-muted-foreground text-[12px] uppercase tracking-wider">{r.label}</span>
                <span
                  className={cn(
                    "font-mono text-xs text-right truncate max-w-[60%]",
                    r.tone === "good" && "text-emerald-400",
                    r.tone === "warn" && "text-amber-400",
                    r.tone === "bad" && "text-rose-400",
                    !r.tone && "text-foreground",
                  )}
                  title={typeof r.value === "string" ? r.value : undefined}
                >
                  {r.value}
                </span>
              </li>
            ))}
        </ul>
      ))}
    </div>
  );
}

// ============================================================
// 4) RANKING DE PLAYLISTS — ordenado por DELIVERY
// ============================================================
type PlaylistAgg = {
  spotify_playlist_id: string;
  name: string;
  owner: string | null;
  spotify_url: string | null;
  entryDate: string | null;        // 1ª detecção VPS (entrada efetiva da música)
  firstSeen: string | null;
  lastSeen: string | null;
  daysActive: number;
  bestPosition: number | null;
  currentPosition: number | null;
  observations: number;
  detectionFrequency: number | null; // observações por dia
  streamsAtEntry: number | null;
  streamsCurrent: number | null;
  deliveryAccumulated: number;       // PRINCIPAL — streams entregues
  growthPct: number | null;
  trend: "subindo" | "estavel" | "caindo" | null;
  timeToFirstDetectionHours: number | null;
  status: "ativa" | "perdida";
  score: number;                     // auxiliar
};

function buildPlaylistRanking(
  placements: Placement[],
  obs: ObserverTrackRow[],
  ssPl: SongSnapPlaylistRow[],
  exec: ExecutionLogRow[],
): PlaylistAgg[] {
  const byPl = new Map<string, PlaylistAgg>();
  const ensure = (id: string, name?: string | null, url?: string | null, owner?: string | null) => {
    if (!byPl.has(id)) {
      byPl.set(id, {
        spotify_playlist_id: id, name: name ?? id, owner: owner ?? null, spotify_url: url ?? null,
        entryDate: null, firstSeen: null, lastSeen: null, daysActive: 0,
        bestPosition: null, currentPosition: null, observations: 0, detectionFrequency: null,
        streamsAtEntry: null, streamsCurrent: null, deliveryAccumulated: 0,
        growthPct: null, trend: null, timeToFirstDetectionHours: null,
        status: "perdida", score: 0,
      });
    } else if (name && byPl.get(id)!.name === id) {
      byPl.get(id)!.name = name;
    }
    return byPl.get(id)!;
  };

  // Observer: posições e datas
  obs.forEach((o) => {
    const r = ensure(o.spotify_playlist_id);
    r.observations += 1;
    if (!r.firstSeen || new Date(o.captured_at) < new Date(r.firstSeen)) r.firstSeen = o.captured_at;
    if (!r.lastSeen || new Date(o.captured_at) > new Date(r.lastSeen)) r.lastSeen = o.captured_at;
    if (o.position != null) {
      if (r.bestPosition == null || o.position < r.bestPosition) r.bestPosition = o.position;
      r.currentPosition = o.position;
    }
  });

  // Plays via song_snapshot_playlists — série temporal por playlist
  const playsSeries = new Map<string, Array<{ at: string; plays: number }>>();
  ssPl.forEach((sp) => {
    const r = ensure(sp.spotify_playlist_id, sp.name, sp.spotify_url, sp.owner);
    if (sp.plays_7d != null) {
      const arr = playsSeries.get(sp.spotify_playlist_id) ?? [];
      arr.push({ at: sp.created_at, plays: sp.plays_7d });
      playsSeries.set(sp.spotify_playlist_id, arr);
    }
  });

  playsSeries.forEach((arr, id) => {
    const r = byPl.get(id)!;
    arr.sort((a, b) => +new Date(a.at) - +new Date(b.at));
    const first = arr[0]?.plays ?? 0;
    const last = arr[arr.length - 1]?.plays ?? 0;
    r.streamsAtEntry = first;
    r.streamsCurrent = last;
    // Delivery acumulado = quanto a playlist entregou desde a entrada
    r.deliveryAccumulated = Math.max(0, last - first);
    if (arr.length >= 2 && first > 0) {
      r.growthPct = Math.round(((last - first) / first) * 1000) / 10;
    } else if (last > 0 && first === 0) {
      r.growthPct = 100;
    }
    // Tendência — compara última terça com penúltima
    if (arr.length >= 3) {
      const tail = arr.slice(-3);
      const delta = tail[2].plays - tail[1].plays;
      const prevDelta = tail[1].plays - tail[0].plays;
      if (delta > 0 && delta >= prevDelta) r.trend = "subindo";
      else if (delta < 0) r.trend = "caindo";
      else r.trend = "estavel";
    } else if (arr.length === 2) {
      r.trend = last > first ? "subindo" : last < first ? "caindo" : "estavel";
    }
  });

  // Tempo até primeira detecção (POST → primeira observação) + entryDate
  const firstPostByPl = new Map<string, string>();
  exec.slice().reverse().forEach((e) => {
    if ((e.outcome === "spotify_post_ok" || e.outcome === "already_present") && e.spotify_playlist_id) {
      if (!firstPostByPl.has(e.spotify_playlist_id)) firstPostByPl.set(e.spotify_playlist_id, e.executed_at);
    }
  });
  byPl.forEach((r) => {
    const post = firstPostByPl.get(r.spotify_playlist_id);
    r.entryDate = r.firstSeen ?? post ?? null;
    if (post && r.firstSeen) {
      const h = (new Date(r.firstSeen).getTime() - new Date(post).getTime()) / 3600_000;
      r.timeToFirstDetectionHours = Math.max(0, Math.round(h * 10) / 10);
    }
  });

  // Name fallback via placements
  placements.forEach((p) => {
    const id = p.managed_playlists?.spotify_playlist_id;
    if (id && byPl.has(id) && p.managed_playlists?.name) {
      byPl.get(id)!.name = p.managed_playlists.name;
    }
  });

  // Status + daysActive + detectionFrequency + score auxiliar
  const now = Date.now();
  byPl.forEach((r) => {
    if (r.firstSeen) {
      const end = r.lastSeen ? new Date(r.lastSeen).getTime() : now;
      r.daysActive = Math.max(1, Math.round((end - new Date(r.firstSeen).getTime()) / 86400_000));
      r.detectionFrequency = Math.round((r.observations / r.daysActive) * 10) / 10;
    }
    if (r.lastSeen) {
      r.status = now - new Date(r.lastSeen).getTime() < 72 * 3600_000 ? "ativa" : "perdida";
    }
    const playScore = Math.min(1, r.deliveryAccumulated / 5000) * 60;
    const retScore = r.status === "ativa" ? 25 : 0;
    const posScore = r.bestPosition != null && r.bestPosition <= 20 ? 15 : 0;
    r.score = Math.round(playScore + retScore + posScore);
  });

  // ORDENAÇÃO: 1) delivery DESC  2) growthPct DESC  3) status ativa  4) bestPosition ASC  5) observations DESC
  return [...byPl.values()].sort((a, b) => {
    if (b.deliveryAccumulated !== a.deliveryAccumulated) return b.deliveryAccumulated - a.deliveryAccumulated;
    const ga = a.growthPct ?? -Infinity, gb = b.growthPct ?? -Infinity;
    if (gb !== ga) return gb - ga;
    if (a.status !== b.status) return a.status === "ativa" ? -1 : 1;
    const pa = a.bestPosition ?? 9999, pb = b.bestPosition ?? 9999;
    if (pa !== pb) return pa - pb;
    return b.observations - a.observations;
  });
}

function TrendBadge({ t }: { t: PlaylistAgg["trend"] }) {
  if (!t) return <span className="text-muted-foreground">—</span>;
  const map = {
    subindo: { cls: "text-emerald-400", icon: ArrowUpRight, label: "subindo" },
    estavel: { cls: "text-muted-foreground", icon: Activity, label: "estável" },
    caindo: { cls: "text-rose-400", icon: ArrowDownRight, label: "caindo" },
  } as const;
  const M = map[t];
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] uppercase tracking-wider", M.cls)}>
      <M.icon className="h-3 w-3" />{M.label}
    </span>
  );
}

function PlaylistRankingPanel({ placements, obs, ssPl, exec }: {
  placements: Placement[]; obs: ObserverTrackRow[]; ssPl: SongSnapPlaylistRow[]; exec: ExecutionLogRow[];
}) {
  const rows = useMemo(() => buildPlaylistRanking(placements, obs, ssPl, exec), [placements, obs, ssPl, exec]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  if (rows.length === 0) {
    return <div className="p-6 text-center text-xs text-muted-foreground">Sem dados de playlists ainda.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr className="border-b border-border">
            <th className="text-left font-medium px-3 py-2.5 w-8"></th>
            <th className="text-left font-medium px-3 py-2.5">Playlist</th>
            <th className="text-right font-medium px-3 py-2.5 text-emerald-400">Delivery</th>
            <th className="text-right font-medium px-3 py-2.5 hidden sm:table-cell">Cresc.</th>
            <th className="text-right font-medium px-3 py-2.5 hidden md:table-cell">Dias</th>
            <th className="text-right font-medium px-3 py-2.5 hidden md:table-cell">Tendência</th>
            <th className="text-right font-medium px-3 py-2.5 hidden lg:table-cell">Melhor pos</th>
            <th className="text-right font-medium px-3 py-2.5 hidden lg:table-cell">Última coleta</th>
            <th className="text-right font-medium px-3 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = expanded.has(r.spotify_playlist_id);
            return (
              <>
                <tr
                  key={r.spotify_playlist_id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer"
                  onClick={() => toggle(r.spotify_playlist_id)}
                >
                  <td className="px-3 py-2 text-muted-foreground">
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
                  </td>
                  <td className="px-3 py-2 max-w-[240px]">
                    {r.spotify_url ? (
                      <a href={r.spotify_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-foreground hover:text-primary inline-flex items-center gap-1 truncate">
                        <span className="truncate">{r.name}</span><ExternalLink className="h-3 w-3 opacity-60 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-foreground truncate block">{r.name}</span>
                    )}
                    {r.owner && <span className="block text-[10px] text-muted-foreground truncate">{r.owner}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={cn(
                      "font-mono text-sm tabular-nums font-semibold",
                      r.deliveryAccumulated > 0 ? "text-emerald-400" : "text-muted-foreground",
                    )}>
                      {r.deliveryAccumulated > 0 ? `+${fmt(r.deliveryAccumulated)}` : "+0"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs hidden sm:table-cell">
                    {r.growthPct == null ? "—" : (
                      <span className={r.growthPct >= 0 ? "text-emerald-400" : "text-rose-400"}>
                        {r.growthPct >= 0 ? "+" : ""}{r.growthPct}%
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground hidden md:table-cell">{r.daysActive}d</td>
                  <td className="px-3 py-2 text-right hidden md:table-cell"><TrendBadge t={r.trend} /></td>
                  <td className="px-3 py-2 text-right font-mono text-xs hidden lg:table-cell">{r.bestPosition != null ? `#${r.bestPosition}` : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground hidden lg:table-cell">{rel(r.lastSeen)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={cn(
                      "inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider",
                      r.status === "ativa" ? "text-emerald-400" : "text-muted-foreground",
                    )}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", r.status === "ativa" ? "bg-emerald-500" : "bg-muted-foreground/60")} />
                      {r.status}
                    </span>
                  </td>
                </tr>
                {isOpen && (
                  <tr key={`${r.spotify_playlist_id}-x`} className="border-b border-border bg-muted/10">
                    <td></td>
                    <td colSpan={8} className="px-3 py-3">
                      <dl className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-2 text-[11px]">
                        {[
                          ["Streams na entrada", fmt(r.streamsAtEntry)],
                          ["Streams atuais", fmt(r.streamsCurrent)],
                          ["Data de entrada", d(r.entryDate)],
                          ["Posição atual", r.currentPosition != null ? `#${r.currentPosition}` : "—"],
                          ["Freq. detecção", r.detectionFrequency != null ? `${r.detectionFrequency}/d` : "—"],
                          ["Tempo até 1ª detecção", r.timeToFirstDetectionHours != null ? `${r.timeToFirstDetectionHours}h` : "—"],
                          ["Observações", String(r.observations)],
                          ["Score (auxiliar)", String(r.score)],
                        ].map(([k, v]) => (
                          <div key={k} className="flex flex-col gap-0.5">
                            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt>
                            <dd className="font-mono text-foreground">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// RESUMO EXECUTIVO
// ============================================================
function ExecutiveSummary({
  baseline, telemetry, ranking,
}: {
  baseline: Baseline;
  telemetry: Telemetry;
  ranking: PlaylistAgg[];
}) {
  const totalDelivery = ranking.reduce((s, r) => s + r.deliveryAccumulated, 0);
  const ativas = ranking.filter((r) => r.status === "ativa").length;
  const best = ranking[0] ?? null;
  const growth = telemetry?.growth_pct ?? null;
  const growthAbs = telemetry?.growth_abs ?? null;
  const status: { label: string; tone: "good" | "warn" | "bad" | "neutral" } =
    growth == null
      ? { label: "Sem dado", tone: "neutral" }
      : growth >= 10
      ? { label: "Crescendo", tone: "good" }
      : growth <= -10
      ? { label: "Perdendo força", tone: "bad" }
      : { label: "Estável", tone: "warn" };

  const kpis: Array<{ k: string; v: React.ReactNode; sub?: string; tone?: "good" | "warn" | "bad" }> = [
    { k: "Baseline", v: baseline?.streams != null ? fmt(baseline.streams) : "—", sub: baseline?.captured_at ? d(baseline.captured_at) : undefined },
    { k: "Streams atuais", v: fmt(telemetry?.last_plays_28d), sub: "últimos 28d" },
    { k: "Delivery acumulado", v: <span className="text-emerald-400">{totalDelivery > 0 ? `+${fmt(totalDelivery)}` : "+0"}</span>, sub: "via playlists" },
    {
      k: "Crescimento",
      v: growth == null ? "—" : <span className={growth >= 0 ? "text-emerald-400" : "text-rose-400"}>{growth >= 0 ? "+" : ""}{growth}%</span>,
      sub: growthAbs != null ? `${growthAbs >= 0 ? "+" : ""}${fmt(growthAbs)} streams` : undefined,
    },
    { k: "Playlists ativas", v: String(ativas), sub: `${ranking.length} total` },
    { k: "Melhor playlist", v: best ? <span className="truncate block max-w-[180px]" title={best.name}>{best.name}</span> : "—", sub: best ? `+${fmt(best.deliveryAccumulated)} delivery` : undefined },
    { k: "Última coleta", v: rel(telemetry?.last_captured_at), sub: telemetry?.last_captured_at ? dt(telemetry.last_captured_at) : undefined },
    { k: "Status", v: <span className={cn(status.tone === "good" && "text-emerald-400", status.tone === "warn" && "text-amber-400", status.tone === "bad" && "text-rose-400")}>{status.label}</span> },
  ];

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-4 w-4 text-[#1DB954]" />
        <h3 className="text-sm font-semibold text-foreground">Resumo executivo</h3>
      </div>
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-4">
        {kpis.map((k) => (
          <div key={k.k} className="flex flex-col gap-0.5 min-w-0">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.k}</dt>
            <dd className="text-lg font-semibold text-foreground font-mono tabular-nums truncate">{k.v}</dd>
            {k.sub && <dd className="text-[11px] text-muted-foreground truncate">{k.sub}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}


// ============================================================
// 5) LINHA DO TEMPO DOS PLACEMENTS
// ============================================================
function PlacementTimelinesPanel({ placements, exec, obs }: {
  placements: Placement[]; exec: ExecutionLogRow[]; obs: ObserverTrackRow[];
}) {
  const rows = useMemo(() => {
    return placements
      .map((p) => {
        const spId = p.managed_playlists?.spotify_playlist_id ?? null;
        const myExec = exec.filter((e) => e.placement_id === p.id || (spId && e.spotify_playlist_id === spId));
        const created = p.scheduled_for;
        const post = [...myExec].reverse().find((e) => e.outcome === "spotify_post_ok");
        const confirmed = [...myExec].reverse().find((e) => e.outcome === "spotify_post_ok" || e.outcome === "already_present");
        const myObs = spId ? obs.filter((o) => o.spotify_playlist_id === spId) : [];
        const firstObs = myObs[0]?.captured_at ?? null;
        const lastObs = myObs.at(-1)?.captured_at ?? null;
        const removed = p.status === "removed" ? (p.added_at ?? null) : null;
        return { p, created, post: post?.executed_at ?? null, confirmed: confirmed?.executed_at ?? null, firstObs, lastObs, removed };
      })
      .sort((a, b) => +new Date(b.confirmed ?? b.created) - +new Date(a.confirmed ?? a.created))
      .slice(0, 30);
  }, [placements, exec, obs]);

  if (rows.length === 0) {
    return <div className="p-6 text-center text-xs text-muted-foreground">Sem placements ainda.</div>;
  }

  return (
    <div className="divide-y divide-border">
      {rows.map(({ p, created, post, confirmed, firstObs, lastObs, removed }) => {
        const name = p.managed_playlists?.name ?? "—";
        const url = p.managed_playlists?.spotify_playlist_id ? `https://open.spotify.com/playlist/${p.managed_playlists.spotify_playlist_id}` : null;
        const steps = [
          { label: "Criado", at: created, ok: !!created },
          { label: "POST", at: post, ok: !!post },
          { label: "Confirmado", at: confirmed, ok: !!confirmed },
          { label: "Detectado VPS", at: firstObs, ok: !!firstObs },
          { label: "Última detecção", at: lastObs, ok: !!lastObs },
          { label: "Removido", at: removed, ok: !!removed, terminal: true },
        ];
        return (
          <div key={p.id} className="p-4 sm:p-5">
            <div className="flex items-center justify-between mb-2 gap-2">
              <div className="min-w-0 flex-1">
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" className="text-sm font-medium text-foreground hover:text-primary inline-flex items-center gap-1 truncate">
                    <span className="truncate">{name}</span><ExternalLink className="h-3 w-3 opacity-60 shrink-0" />
                  </a>
                ) : (
                  <span className="text-sm font-medium text-foreground truncate block">{name}</span>
                )}
              </div>
              <span className={cn(
                "text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0",
                p.status === "active" && "bg-emerald-500/10 text-emerald-400",
                p.status === "failed" && "bg-rose-500/10 text-rose-400",
                p.status === "removed" && "bg-muted/30 text-muted-foreground",
                (p.status === "pending" || p.status === "processing" || p.status === "retry") && "bg-amber-500/10 text-amber-400",
              )}>
                {p.status}
              </span>
            </div>
            <ol className="grid grid-cols-2 sm:grid-cols-6 gap-2">
              {steps.map((s, i) => (
                <li key={s.label} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      s.terminal && s.ok ? "bg-rose-500" : s.ok ? "bg-emerald-500" : "bg-muted-foreground/30",
                    )} />
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</span>
                  </div>
                  <span className={cn("text-[11px] font-mono tabular-nums", s.ok ? "text-foreground" : "text-muted-foreground/40")}>
                    {s.at ? dt(s.at) : "—"}
                  </span>
                </li>
              ))}
            </ol>
            {p.last_error_code && (
              <div className="mt-2 text-[11px] text-rose-300 font-mono">{p.last_error_code}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// 6) FEED DE EVENTOS
// ============================================================
type FeedEvent = { at: string; tone: "good" | "warn" | "bad" | "neutral"; icon: React.ComponentType<{ className?: string }>; text: string };

function buildFeed(
  placements: Placement[],
  baseline: Baseline,
  snapshots: Snapshot[],
  exec: ExecutionLogRow[],
  obs: ObserverTrackRow[],
): FeedEvent[] {
  const items: FeedEvent[] = [];

  // Baseline criada
  if (baseline?.captured_at) {
    items.push({
      at: baseline.captured_at, tone: "good", icon: CheckCircle2,
      text: `Baseline criada${baseline.streams != null ? ` (${fmt(baseline.streams)} streams).` : "."}`,
    });
  }

  // Entradas em playlist (primeira detecção VPS por playlist)
  const firstSeen = new Map<string, ObserverTrackRow>();
  obs.forEach((o) => {
    if (!firstSeen.has(o.spotify_playlist_id)) firstSeen.set(o.spotify_playlist_id, o);
  });
  firstSeen.forEach((o) => {
    const name = namePlaylist(placements, o.spotify_playlist_id) ?? o.spotify_playlist_id;
    items.push({
      at: o.captured_at, tone: "good", icon: ListMusic,
      text: `Nova playlist detectada: "${name}".`,
    });
  });

  // Saídas inferidas (>72h sem detecção)
  const lastSeen = new Map<string, ObserverTrackRow>();
  obs.forEach((o) => {
    const cur = lastSeen.get(o.spotify_playlist_id);
    if (!cur || new Date(o.captured_at) > new Date(cur.captured_at)) lastSeen.set(o.spotify_playlist_id, o);
  });
  const now = Date.now();
  lastSeen.forEach((o) => {
    if (now - new Date(o.captured_at).getTime() > 72 * 3600_000) {
      const name = namePlaylist(placements, o.spotify_playlist_id) ?? o.spotify_playlist_id;
      items.push({
        at: o.captured_at, tone: "warn", icon: GitBranch,
        text: `Playlist removida: "${name}".`,
      });
    }
  });

  // Crescimento/queda de streams (snapshot a snapshot)
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1].total_plays_28d ?? 0;
    const cur = snapshots[i].total_plays_28d ?? 0;
    const diff = cur - prev;
    if (Math.abs(diff) >= 100) {
      items.push({
        at: snapshots[i].captured_at,
        tone: diff > 0 ? "good" : "warn",
        icon: diff > 0 ? ArrowUpRight : ArrowDownRight,
        text: diff > 0
          ? `Streams cresceram +${fmt(diff)} (delivery atualizado).`
          : `Streams caíram ${fmt(diff)}.`,
      });
    }
  }

  // Coletas recentes (até 3)
  snapshots.slice(-3).forEach((s) => {
    items.push({ at: s.captured_at, tone: "neutral", icon: Activity, text: "Nova coleta recebida." });
  });

  // Novo pico (snapshot que superou todos os anteriores)
  let runningPeak = 0;
  snapshots.forEach((s) => {
    const v = s.total_plays_28d ?? 0;
    if (v > runningPeak && runningPeak > 0) {
      items.push({ at: s.captured_at, tone: "good", icon: TrendingUp, text: `Novo pico de streams: ${fmt(v)}.` });
    }
    if (v > runningPeak) runningPeak = v;
  });

  // Placements confirmados (apenas business — ignora códigos técnicos)
  exec.slice(0, 40).forEach((e) => {
    if (e.outcome === "spotify_post_ok") {
      const name = namePlaylist(placements, e.spotify_playlist_id) ?? "playlist";
      items.push({ at: e.executed_at, tone: "good", icon: CheckCircle2, text: `Placement confirmado em "${name}".` });
    }
  });

  return items.sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 60);
}

function EventFeedPanel(props: { placements: Placement[]; baseline: Baseline; snapshots: Snapshot[]; exec: ExecutionLogRow[]; obs: ObserverTrackRow[] }) {
  const items = useMemo(() => buildFeed(props.placements, props.baseline, props.snapshots, props.exec, props.obs), [props]);
  if (items.length === 0) {
    return <div className="p-6 text-center text-xs text-muted-foreground">Sem eventos.</div>;
  }
  return (
    <ul className="divide-y divide-border max-h-[480px] overflow-y-auto">
      {items.map((e, i) => (
        <li key={i} className="flex items-start gap-3 px-4 sm:px-5 py-2.5 text-sm">
          <e.icon className={cn(
            "h-3.5 w-3.5 mt-1 shrink-0",
            e.tone === "good" && "text-emerald-400",
            e.tone === "warn" && "text-amber-400",
            e.tone === "bad" && "text-rose-400",
            e.tone === "neutral" && "text-muted-foreground",
          )} />
          <div className="min-w-0 flex-1">
            <div className="text-foreground text-[13px]">{e.text}</div>
            <div className="text-[10px] font-mono text-muted-foreground tabular-nums">{dt(e.at)} · {rel(e.at)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ============================================================
// MAIN
// ============================================================
export function MusicaIntelligenceSection(props: MusicaIntelligenceProps) {
  const spotifyPlaylistIds = useMemo(
    () => Array.from(new Set(props.placements.map((p) => p.managed_playlists?.spotify_playlist_id).filter(Boolean))) as string[],
    [props.placements],
  );
  const snapshotIds = useMemo(() => props.snapshots.map((s) => s.id), [props.snapshots]);

  const q = useCatalogTrackIntelligence({
    catalogTrackId: props.track.id,
    spotifyTrackId: props.track.spotify_track_id,
    spotifyPlaylistIds,
    snapshotIds,
  });

  if (q.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const intel = q.data;
  if (!intel) {
    return <div className="text-sm text-muted-foreground">Não foi possível carregar a inteligência.</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Timeline da música" hint="Cadastro → baseline → playlists → picos → última coleta" icon={History}>
        <TimelinePanel {...props} exec={intel.executionLog} obs={intel.observerTracks} />
      </Panel>

      <Panel title="Saúde operacional" hint="Worker, VPS, fila, breaker e último erro" icon={Server} defaultOpen>
        <OperationalHealthPanel {...props} exec={intel.executionLog} breakers={intel.breakers} vps={intel.vpsAssignments} />
      </Panel>

      <Panel title="Ranking de playlists" hint="Ordenado por DELIVERY (streams entregues) — score só auxiliar" icon={Award} defaultOpen>
        <PlaylistRankingPanel placements={props.placements} obs={intel.observerTracks} ssPl={intel.songSnapPlaylists} exec={intel.executionLog} />
      </Panel>

      <Panel title="Linha do tempo de cada placement" hint="Criado → POST → confirmado → detectado → removido" icon={Clock}>
        <PlacementTimelinesPanel placements={props.placements} exec={intel.executionLog} obs={intel.observerTracks} />
      </Panel>

      <Panel title="Histórico de distribuição" hint="Entradas, saídas e total por dia" icon={TrendingUp}>
        <DistributionHistoryPanel placements={props.placements} exec={intel.executionLog} />
      </Panel>

      <Panel title="Feed de eventos" hint="Eventos de negócio: entradas, saídas, crescimento, coletas" icon={Sparkles}>
        <EventFeedPanel placements={props.placements} baseline={props.baseline} snapshots={props.snapshots} exec={intel.executionLog} obs={intel.observerTracks} />
      </Panel>
    </div>
  );
}
