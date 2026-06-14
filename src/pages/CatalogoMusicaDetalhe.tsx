// Detalhe de uma música do catálogo — dados reais.
// Lê: catalog_tracks, catalog_track_baselines, v_catalog_track_telemetry,
//     v_catalog_track_playlist_attribution, catalog_placements (+managed_playlists),
//     catalog_snapshot_queue, song_snapshots.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Music2, Layers, TrendingUp, Activity, ExternalLink,
  BarChart3, ListMusic, History, Gauge, CheckCircle2, AlertTriangle, Clock,
  PlayCircle, RefreshCw, ChevronDown,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { KpiBig } from "@/components/KpiBig";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

type Track = {
  id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  cover_url: string | null;
  isrc: string | null;
  status: string;
  added_at: string;
};
type Baseline = {
  captured_at: string;
  popularity: number | null;
  monthly_listeners: number | null;
  streams: number | null;
};
type Telemetry = {
  baseline_at: string | null;
  baseline_plays_28d: number | null;
  last_captured_at: string | null;
  last_plays_28d: number | null;
  growth_abs: number | null;
  growth_pct: number | null;
  playlists_present_count: number;
  total_plays_7d_from_playlists: number;
  snapshots_count: number;
};
type Placement = {
  id: string;
  status: string;
  position: number | null;
  added_at: string | null;
  scheduled_for: string;
  attempts: number;
  last_error_code: string | null;
  managed_playlists: { name: string; cover_url: string | null; followers: number | null; spotify_playlist_id: string | null; archived_at: string | null; execution_mode: string | null } | null;
};
type Attribution = {
  spotify_playlist_id: string;
  name: string;
  owner: string | null;
  spotify_url: string | null;
  first_seen_at: string;
  last_seen_at: string;
  observations: number;
  current_position: number | null;
  current_plays_7d: number | null;
  status: string;
};
type QueueRow = { status: string; scheduled_for: string; attempts: number; max_attempts: number; last_error: string | null; locked_at: string | null };
type Snapshot = { id: string; captured_at: string; total_plays_28d: number | null; processing_error: string | null };
type Batch = { id: string; created_at: string; total_eligible_playlists: number; skipped_already_present: number; skipped_no_capacity: number; placements_created: number };

const fmt = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("pt-BR") : "—");
const rel = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const min = Math.round(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.round(h / 24);
  return `há ${days} d`;
};

async function fetchDetail(id: string) {
  const [trackRes, baselineRes, telemetryRes, placementsRes, attributionRes, queueRes, snapshotsRes, batchesRes] = await Promise.all([
    supabase.from("catalog_tracks").select("id, spotify_track_id, track_name, artist_name, cover_url, isrc, status, added_at").eq("id", id).maybeSingle(),
    supabase.from("catalog_track_baselines").select("captured_at, popularity, monthly_listeners, streams").eq("catalog_track_id", id).maybeSingle(),
    supabase.from("v_catalog_track_telemetry").select("baseline_at, baseline_plays_28d, last_captured_at, last_plays_28d, growth_abs, growth_pct, playlists_present_count, total_plays_7d_from_playlists, snapshots_count").eq("catalog_track_id", id).maybeSingle(),
    supabase.from("catalog_placements").select("id, status, position, added_at, scheduled_for, attempts, last_error_code, managed_playlists:managed_playlist_id(name, cover_url, followers, spotify_playlist_id, archived_at, execution_mode)").eq("catalog_track_id", id).order("status", { ascending: true }),
    supabase.from("v_catalog_track_playlist_attribution").select("spotify_playlist_id, name, owner, spotify_url, first_seen_at, last_seen_at, observations, current_position, current_plays_7d, status").eq("catalog_track_id", id).order("current_plays_7d", { ascending: false, nullsFirst: false }),
    supabase.from("catalog_snapshot_queue").select("status, scheduled_for, attempts, max_attempts, last_error, locked_at").eq("catalog_track_id", id).order("scheduled_for", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("song_snapshots").select("id, captured_at, total_plays_28d, processing_error").eq("catalog_track_id", id).order("captured_at", { ascending: true }).limit(60),
    supabase.from("catalog_distribution_batches").select("id, created_at, total_eligible_playlists, skipped_already_present, skipped_no_capacity, placements_created").eq("catalog_track_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  return {
    track: trackRes.data as Track | null,
    baseline: baselineRes.data as Baseline | null,
    telemetry: telemetryRes.data as Telemetry | null,
    placements: (placementsRes.data ?? []) as unknown as Placement[],
    attribution: (attributionRes.data ?? []) as Attribution[],
    queue: queueRes.data as QueueRow | null,
    snapshots: (snapshotsRes.data ?? []) as Snapshot[],
    batches: (batchesRes.data ?? []) as Batch[],
  };
}

function StatusDot({ status }: { status: string }) {
  const m: Record<string, { cls: string; label: string }> = {
    active: { cls: "bg-emerald-500", label: "Ativa" },
    pending: { cls: "bg-amber-500", label: "Pendente" },
    processing: { cls: "bg-sky-400", label: "Processando" },
    retry: { cls: "bg-amber-500", label: "Retry" },
    failed: { cls: "bg-rose-500", label: "Falha" },
    removed: { cls: "bg-zinc-500", label: "Removida" },
  };
  const s = m[status] ?? { cls: "bg-zinc-500", label: status };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", s.cls)} />
      {s.label}
    </span>
  );
}

function Sparkline({ points }: { points: Snapshot[] }) {
  const w = 720, h = 200, pad = 24;
  if (points.length < 2) {
    return (
      <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
        {points.length === 0 ? "Sem snapshots ainda — primeira coleta abre o gráfico." : "Apenas 1 snapshot. Aguardando a próxima coleta para desenhar a curva."}
      </div>
    );
  }
  const ys = points.map((p) => p.total_plays_28d ?? 0);
  const maxY = Math.max(...ys, 1);
  const minY = Math.min(...ys);
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - minY) / Math.max(1, maxY - minY)) * (h - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.total_plays_28d ?? 0)}`).join(" ");
  const area = `${path} L ${x(points.length - 1)} ${h - pad} L ${x(0)} ${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[200px]">
      <defs>
        <linearGradient id="splFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.25" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((t) => (
        <line key={t} x1={pad} x2={w - pad} y1={pad + (h - pad * 2) * t} y2={pad + (h - pad * 2) * t} stroke="hsl(var(--border))" strokeDasharray="2 4" strokeWidth={1} />
      ))}
      <path d={area} fill="url(#splFill)" />
      <path d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth={2.5} />
    </svg>
  );
}

function MobilePlacementsRow({ p }: { p: Placement }) {
  const pos = p.position;
  const posCls = pos == null
    ? "text-muted-foreground/40"
    : pos === 1
      ? "text-[#1DB954]"
      : pos <= 20
        ? "text-foreground"
        : pos <= 50
          ? "text-muted-foreground"
          : "text-muted-foreground/60";
  return (
    <div className="flex items-center gap-3 px-4 py-2 active:bg-[hsl(0,0%,13%)] transition-colors">
      {p.managed_playlists?.cover_url ? (
        <img src={p.managed_playlists.cover_url} alt="" className="w-10 h-10 rounded flex-shrink-0 object-cover bg-muted" />
      ) : (
        <div className="w-10 h-10 rounded flex-shrink-0 bg-muted flex items-center justify-center"><PlayCircle className="h-4 w-4 text-muted-foreground" /></div>
      )}
      <div className="flex-1 min-w-0">
        <h3 className="text-foreground text-[13px] font-medium truncate leading-none">{p.managed_playlists?.name ?? "—"}</h3>
        <p className="text-muted-foreground text-[11px] mt-1 tabular-nums truncate">
          {fmt(p.managed_playlists?.followers)} seguidores
          {p.last_error_code && <span className="text-rose-400 ml-2 font-mono">{p.last_error_code}</span>}
        </p>
      </div>
      <div className="flex-shrink-0 text-right min-w-[40px]">
        <span className={cn("text-sm font-bold tabular-nums tracking-tighter", posCls)}>
          {pos != null ? `#${pos}` : "—"}
        </span>
      </div>
    </div>
  );
}

const placementStatusOrder: Record<string, number> = {
  active: 0,
  processing: 1,
  pending: 2,
  retry: 3,
  failed: 4,
  removed: 5,
};

function summarizePlacementsGroup(items: Placement[]) {
  return items.reduce(
    (acc, p) => {
      acc.total += 1;
      if (p.status === "active") acc.active += 1;
      else if (p.status === "failed") acc.failed += 1;
      else if (p.status === "removed") acc.removed += 1;
      else acc.queue += 1;
      return acc;
    },
    { total: 0, active: 0, queue: 0, failed: 0, removed: 0 }
  );
}

function sortPlacementsGroup(items: Placement[]) {
  return [...items].sort((a, b) => {
    const statusDiff = (placementStatusOrder[a.status] ?? 9) - (placementStatusOrder[b.status] ?? 9);
    if (statusDiff !== 0) return statusDiff;
    const posA = a.position ?? Number.MAX_SAFE_INTEGER;
    const posB = b.position ?? Number.MAX_SAFE_INTEGER;
    if (posA !== posB) return posA - posB;
    return (a.managed_playlists?.name ?? "").localeCompare(b.managed_playlists?.name ?? "", "pt-BR");
  });
}

function isOperationalPlacement(p: Placement) {
  return !p.managed_playlists?.archived_at && p.managed_playlists?.execution_mode !== "DISABLED";
}

function MobilePlacementsSummary({ summary }: { summary: ReturnType<typeof summarizePlacementsGroup> }) {
  return (
    <div className="grid grid-cols-4 gap-[1px] overflow-hidden rounded-lg border border-border bg-border">
      <div className="bg-black/25 px-2 py-2">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Ativos</div>
        <div className="text-sm font-bold tabular-nums text-foreground">{summary.active}</div>
      </div>
      <div className="bg-black/25 px-2 py-2">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Fila</div>
        <div className="text-sm font-bold tabular-nums text-foreground">{summary.queue}</div>
      </div>
      <div className="bg-black/25 px-2 py-2">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Falhas</div>
        <div className="text-sm font-bold tabular-nums text-foreground">{summary.failed}</div>
      </div>
      <div className="bg-black/25 px-2 py-2">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Remov.</div>
        <div className="text-sm font-bold tabular-nums text-foreground">{summary.removed}</div>
      </div>
    </div>
  );
}

function MobilePlacementsGroups({ placements }: { placements: Placement[] }) {
  const [openHibrido, setOpenHibrido] = useState(false);
  const [openCatalogo, setOpenCatalogo] = useState(false);

  const hibrido = sortPlacementsGroup(placements.filter(isOperationalPlacement));
  const catalogo = sortPlacementsGroup(placements.filter((p) => !isOperationalPlacement(p)));
  const hibridoSummary = summarizePlacementsGroup(hibrido);
  const catalogoSummary = summarizePlacementsGroup(catalogo);

  return (
    <div className="sm:hidden space-y-2 p-2">
      {/* Híbrido */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setOpenHibrido((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 active:bg-[hsl(0,0%,13%)] transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#1DB954] shadow-[0_0_8px_rgba(29,185,84,0.5)]" />
            <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Híbrido</span>
            <span className="text-[10px] font-mono tabular-nums text-muted-foreground bg-black/30 border border-border rounded px-1.5 py-0.5">ativas</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tabular-nums text-foreground">{hibridoSummary.total}</span>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", openHibrido && "rotate-180")} />
          </div>
        </button>
        <div className="px-3 pb-3">
          <MobilePlacementsSummary summary={hibridoSummary} />
        </div>
        {openHibrido && (
          <div className="divide-y divide-border border-t border-border bg-black/20">
            {hibrido.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">Nenhum placement ativo.</div>
            ) : (
              hibrido.map((p) => <MobilePlacementsRow key={p.id} p={p} />)
            )}
          </div>
        )}
      </div>

      {/* Catálogo */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setOpenCatalogo((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 active:bg-[hsl(0,0%,13%)] transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60" />
            <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Catálogo</span>
            <span className="text-[10px] font-mono tabular-nums text-muted-foreground bg-black/30 border border-border rounded px-1.5 py-0.5">arquivadas</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tabular-nums text-foreground">{catalogoSummary.total}</span>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", openCatalogo && "rotate-180")} />
          </div>
        </button>
        <div className="px-3 pb-3">
          <MobilePlacementsSummary summary={catalogoSummary} />
        </div>
        {openCatalogo && (
          <div className="divide-y divide-border border-t border-border bg-black/20">
            {catalogo.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">Nenhum placement no catálogo.</div>
            ) : (
              catalogo.map((p) => <MobilePlacementsRow key={p.id} p={p} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CatalogoMusicaDetalhe() {
  const { id = "" } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["catalog", "detail", id], queryFn: () => fetchDetail(id), enabled: !!id, refetchInterval: 30_000 });

  const placementsByStatus = useMemo(() => {
    const m: Record<string, number> = { active: 0, pending: 0, processing: 0, retry: 0, failed: 0, removed: 0 };
    (q.data?.placements ?? []).forEach((p) => { m[p.status] = (m[p.status] ?? 0) + 1; });
    return m;
  }, [q.data]);

  const reach = useMemo(() => (q.data?.placements ?? [])
    .filter((p) => p.status === "active")
    .reduce((s, p) => s + (p.managed_playlists?.followers ?? 0), 0), [q.data]);

  if (q.isLoading) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </PageContainer>
    );
  }
  if (!q.data?.track) {
    return (
      <PageContainer>
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">
          Música não encontrada. <Link to="/catalogo" className="text-primary underline">Voltar ao catálogo</Link>
        </div>
      </PageContainer>
    );
  }
  const t = q.data.track;
  const b = q.data.baseline;
  const tel = q.data.telemetry;
  const placements = q.data.placements;
  const attribution = q.data.attribution;
  const queue = q.data.queue;
  const snapshots = q.data.snapshots;
  const batches = q.data.batches;

  const baselineSnapshot = snapshots[0] ?? null;
  const baselineCapturedAt = tel?.baseline_at ?? baselineSnapshot?.captured_at ?? b?.captured_at ?? null;
  const baselineStreams = tel?.baseline_plays_28d ?? baselineSnapshot?.total_plays_28d ?? b?.streams ?? null;
  const baselineOk = !!baselineCapturedAt && (baselineStreams != null || !!baselineSnapshot || !!b);
  const currentStreams = tel?.last_plays_28d ?? snapshots.at(-1)?.total_plays_28d ?? null;
  const snapshotsCount = tel?.snapshots_count ?? snapshots.length;
  const queueActive = queue && (queue.status === "pending" || queue.status === "processing" || queue.status === "retry");

  return (
    <>
      <PageHeader
        domain="playlists"
        title={t.track_name}
        subtitle={`${t.artist_name}${t.isrc ? ` · ISRC ${t.isrc}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="h-9 rounded-full gap-1.5">
              <Link to="/catalogo"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Voltar</span></Link>
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-full gap-1.5" asChild>
              <a href={`https://open.spotify.com/track/${t.spotify_track_id}`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /><span className="hidden sm:inline">Spotify</span>
              </a>
            </Button>
          </div>
        }
      />

      <PageContainer>
        {/* ============ MOBILE ONLY: HAIRLINE GRID TÉCNICO ============ */}
        <div className="sm:hidden flex flex-col gap-2.5">
          {/* Identity */}
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="flex gap-4 items-start">
              {t.cover_url ? (
                <img src={t.cover_url} alt="" className="w-20 h-20 rounded-lg object-cover shrink-0 border border-white/5 shadow-lg" />
              ) : (
                <div className="w-20 h-20 rounded-lg bg-muted flex items-center justify-center shrink-0 border border-white/5"><Music2 className="h-7 w-7 text-muted-foreground" /></div>
              )}
              <div className="flex flex-col min-w-0 flex-1">
                <h2 className="text-lg font-bold leading-tight text-foreground truncate">{t.track_name}</h2>
                <p className="text-sm text-muted-foreground truncate font-medium">{t.artist_name}</p>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 bg-black/40 border border-border text-muted-foreground rounded text-center truncate">
                    Desde {new Date(t.added_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" })}
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 bg-black/40 border border-border text-muted-foreground rounded tabular-nums text-center truncate">
                    {placementsByStatus.active}/{placements.length} ativas
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-2">
              <div className="flex items-center gap-2 px-2.5 py-1 bg-black/30 border border-border rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#1DB954] shadow-[0_0_8px_rgba(29,185,84,0.5)]" />
                <span className="text-[10px] font-bold text-foreground/90 tabular-nums uppercase tracking-tight">Alcance {fmt(reach)}</span>
              </div>
              <div className="flex items-center gap-2 px-2.5 py-1 bg-black/30 border border-border rounded-full">
                <span className={cn("w-1.5 h-1.5 rounded-full", baselineOk ? "bg-emerald-500" : "bg-amber-500/80")} />
                <span className="text-[10px] font-bold text-foreground/90 uppercase tracking-tight">Baseline {baselineOk ? "OK" : "pendente"}</span>
              </div>
            </div>
          </section>

          {/* KPI Grid 2x2 hairline */}
          <section className="grid grid-cols-2 gap-[1px] bg-border border border-border rounded-xl overflow-hidden">
            <div className="bg-card p-3.5 flex flex-col gap-1">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Streams 28D</span>
              <span className={cn("text-xl font-bold tabular-nums tracking-tighter", tel?.last_plays_28d != null ? "text-foreground" : "text-muted-foreground/40")}>{tel?.last_plays_28d != null ? fmt(tel.last_plays_28d) : "—"}</span>
            </div>
            <div className="bg-card p-3.5 flex flex-col gap-1">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Δ Baseline</span>
              <span className={cn("text-xl font-bold tabular-nums tracking-tighter", tel?.growth_pct == null ? "text-muted-foreground/40" : tel.growth_pct >= 0 ? "text-[#1DB954]" : "text-rose-400")}>
                {tel?.growth_pct != null ? `${tel.growth_pct >= 0 ? "+" : ""}${tel.growth_pct}%` : "—"}
              </span>
            </div>
            <div className="bg-card p-3.5 flex flex-col gap-1">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Playlists</span>
              <span className={cn("text-xl font-bold tabular-nums tracking-tighter", tel?.playlists_present_count ? "text-foreground" : "text-muted-foreground/40")}>{tel?.playlists_present_count ? fmt(tel.playlists_present_count) : "—"}</span>
            </div>
            <div className="bg-card p-3.5 flex flex-col gap-1">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Snapshots</span>
              <span className={cn("text-xl font-bold tabular-nums tracking-tighter", tel?.snapshots_count ? "text-foreground" : "text-muted-foreground/40")}>
                {tel?.snapshots_count ? fmt(tel.snapshots_count) : "—"}
              </span>
            </div>
          </section>

          {/* Baseline T0 */}
          <section className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Baseline T0</h3>
              <span className="text-[9px] text-muted-foreground/60 font-mono tracking-tighter px-1.5 border border-white/5 rounded bg-black/20">
                {baselineCapturedAt ? new Date(baselineCapturedAt).toLocaleDateString("pt-BR") : "—"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="bg-black/20 border border-border rounded-lg p-2.5 flex flex-col items-center">
                <span className="text-[9px] uppercase font-bold text-muted-foreground mb-1">Popularity</span>
                <span className={cn("text-sm font-bold tabular-nums", b?.popularity != null ? "text-foreground" : "text-muted-foreground/40")}>{b?.popularity ?? "—"}</span>
              </div>
              <div className="bg-black/20 border border-border rounded-lg p-2.5 flex flex-col items-center">
                <span className="text-[9px] uppercase font-bold text-muted-foreground mb-1">Ouvintes</span>
                <span className={cn("text-sm font-bold tabular-nums", b?.monthly_listeners != null ? "text-foreground" : "text-muted-foreground/40")}>{fmt(b?.monthly_listeners)}</span>
              </div>
              <div className="bg-black/20 border border-border rounded-lg p-2.5 flex flex-col items-center">
                <span className="text-[9px] uppercase font-bold text-muted-foreground mb-1">Streams</span>
                <span className={cn("text-sm font-bold tabular-nums", baselineStreams != null ? "text-foreground" : "text-muted-foreground/40")}>{fmt(baselineStreams)}</span>
              </div>
            </div>
          </section>

          {/* Fila de coleta compacta */}
          <section className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
            <div className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  {queueActive && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1DB954] opacity-40" />
                  )}
                  <span className={cn("relative inline-flex rounded-full h-2 w-2", queue?.status === "failed" ? "bg-rose-500" : queue ? "bg-[#1DB954]" : "bg-muted-foreground/40")} />
                </span>
                <span className="text-xs font-semibold text-foreground">Fila de coleta</span>
              </div>
              {queue ? (
                <span className="text-[10px] font-mono tabular-nums text-muted-foreground">{new Date(queue.scheduled_for).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              ) : (
                <span className="text-[10px] text-muted-foreground/60">{rel(tel?.last_captured_at)}</span>
              )}
            </div>
            {queueActive && (
              <div className="p-3 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground uppercase tracking-wider font-bold">Tentativas</span>
                <span className="font-mono tabular-nums text-foreground">{queue.attempts}/{queue.max_attempts}</span>
              </div>
            )}
            {queue?.last_error && (
              <div className="p-3 text-[11px] text-rose-300 bg-rose-500/5">{queue.last_error}</div>
            )}
          </section>
        </div>

        {/* ============ DESKTOP / TABLET (mantém original) ============ */}
        {/* HERO */}
        <section className="hidden sm:flex rounded-2xl border border-border bg-card p-5 flex-col sm:flex-row gap-5">
          {t.cover_url ? (
            <img src={t.cover_url} alt="" className="h-28 w-28 rounded-xl object-cover shadow-lg shrink-0" />
          ) : (
            <div className="h-28 w-28 rounded-xl bg-muted flex items-center justify-center shrink-0"><Music2 className="h-8 w-8 text-muted-foreground" /></div>
          )}
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Música do catálogo</div>
              <h2 className="text-2xl font-semibold text-foreground">{t.track_name}</h2>
              <div className="text-sm text-muted-foreground">{t.artist_name}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="text-xs">Ativa desde {new Date(t.added_at).toLocaleDateString("pt-BR")}</Badge>
              <Badge variant="outline" className="text-xs gap-1">
                <CheckCircle2 className={cn("h-3 w-3", placementsByStatus.active > 0 ? "text-emerald-500" : "text-muted-foreground")} />
                {placementsByStatus.active}/{placements.length} placements ativos
              </Badge>
              <Badge variant="outline" className="text-xs gap-1">
                <Layers className="h-3 w-3 text-amber-400" />
                Alcance: {fmt(reach)}
              </Badge>
              <Badge variant="outline" className={cn("text-xs gap-1", baselineOk ? "" : "border-amber-500/40 text-amber-400")}>
                {baselineOk ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <AlertTriangle className="h-3 w-3 text-amber-500" />}
                Baseline {baselineOk ? "capturada" : "pendente"}
              </Badge>
            </div>
          </div>
        </section>

        {/* KPIs desktop */}
        <section className="hidden sm:grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiBig tier="hero" icon={Music2} label="Streams 28d (atual)" value={fmt(tel?.last_plays_28d)} hint={tel?.baseline_plays_28d != null ? `Baseline ${fmt(tel.baseline_plays_28d)}` : "Sem baseline ainda"} domain="playlists" />
          <KpiBig icon={TrendingUp} label="Δ vs baseline" value={tel?.growth_abs != null ? `${tel.growth_abs >= 0 ? "+" : ""}${fmt(tel.growth_abs)}` : "—"} hint={tel?.growth_pct != null ? `${tel.growth_pct >= 0 ? "+" : ""}${tel.growth_pct}%` : "Aguardando 2º snapshot"} domain="campaigns" />
          <KpiBig icon={Layers} label="Playlists detectadas" value={fmt(tel?.playlists_present_count)} hint={`${fmt(tel?.total_plays_7d_from_playlists)} plays 7d (VPS)`} domain="deals" />
          <KpiBig tier="quiet" icon={Activity} label="Snapshots" value={fmt(tel?.snapshots_count)} hint={`Última: ${rel(tel?.last_captured_at)}`} domain="system" />
        </section>

        {/* BASELINE + COLETA desktop */}
        <section className="hidden sm:grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Baseline T0</h3>
                <p className="text-xs text-muted-foreground">Estado inicial capturado na entrada</p>
              </div>
              {baselineOk ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
            </div>
            {b ? (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] uppercase text-muted-foreground">Popularity</div>
                  <div className="text-lg font-semibold font-mono">{b.popularity ?? "—"}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] uppercase text-muted-foreground">Ouvintes/mês</div>
                  <div className="text-lg font-semibold font-mono">{fmt(b.monthly_listeners)}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] uppercase text-muted-foreground">Streams</div>
                  <div className="text-lg font-semibold font-mono">{fmt(b.streams)}</div>
                </div>
                <div className="col-span-3 text-[11px] text-muted-foreground">
                  Capturada {new Date(b.captured_at).toLocaleString("pt-BR")}
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Baseline ainda não chegou. O bot deve gravar nas próximas coletas.</div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Fila de coleta</h3>
                <p className="text-xs text-muted-foreground">Próxima rodada do bot</p>
              </div>
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            </div>
            {queue ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Status</span><StatusDot status={queue.status === "pending" || queue.status === "processing" ? queue.status : queue.status === "failed" ? "failed" : "pending"} /></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Agendada para</span><span className="font-mono text-xs">{new Date(queue.scheduled_for).toLocaleString("pt-BR")}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tentativas</span><span className="font-mono text-xs">{queue.attempts}/{queue.max_attempts}</span></div>
                {queue.last_error && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-300">{queue.last_error}</div>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Nenhum item na fila. Última coleta {rel(tel?.last_captured_at)}.</div>
            )}
          </div>
        </section>


        {/* CURVA */}
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Evolução de streams</h3>
              <p className="text-xs text-muted-foreground">Streams nos últimos 28 dias</p>
            </div>
            <div className="text-xs text-muted-foreground">{snapshots.length} coletas</div>
          </div>
          <Sparkline points={snapshots} />
        </section>

        {/* PLACEMENTS GERENCIADOS */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><ListMusic className="h-4 w-4" /> Playlists da nossa rede</h3>
              <p className="text-xs text-muted-foreground">
                <span className="sm:hidden">{placementsByStatus.active} ativas · {placementsByStatus.pending + placementsByStatus.retry + placementsByStatus.processing} em fila</span>
                <span className="hidden sm:inline">{placementsByStatus.active} ativas · {placementsByStatus.pending + placementsByStatus.retry + placementsByStatus.processing} em fila · {placementsByStatus.failed} com erro · {placementsByStatus.removed} removidas</span>
              </p>
            </div>
          </div>
          {placements.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Sem placements ainda.</div>
          ) : (
            <>
              {/* MOBILE: dois grupos colapsáveis (Híbrido ≤ #19, Catálogo > #19) */}
              <MobilePlacementsGroups placements={placements} />


              {/* DESKTOP: tabela completa */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="text-left font-medium px-4 py-3">Playlist</th>
                      <th className="text-left font-medium px-4 py-3">Seguidores</th>
                      <th className="text-left font-medium px-4 py-3">Posição</th>
                      <th className="text-left font-medium px-4 py-3">Adicionada</th>
                      <th className="text-left font-medium px-4 py-3">Tentativas</th>
                      <th className="text-left font-medium px-4 py-3">Status / erro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {placements.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {p.managed_playlists?.cover_url ? (
                              <img src={p.managed_playlists.cover_url} alt="" className="h-7 w-7 rounded object-cover" />
                            ) : (
                              <div className="h-7 w-7 rounded bg-muted flex items-center justify-center"><PlayCircle className="h-3.5 w-3.5 text-muted-foreground" /></div>
                            )}
                            <span className="font-medium text-foreground">{p.managed_playlists?.name ?? "—"}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{fmt(p.managed_playlists?.followers)}</td>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{p.position != null ? `#${p.position}` : "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{p.added_at ? new Date(p.added_at).toLocaleDateString("pt-BR") : "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{p.attempts}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <StatusDot status={p.status} />
                            {p.last_error_code && <span className="text-[10px] text-rose-400 font-mono">{p.last_error_code}</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>


        {/* ATRIBUIÇÃO VPS — playlists onde o bot detectou a faixa */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-5 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><History className="h-4 w-4" /> Playlists onde aparecemos</h3>
            <p className="text-xs text-muted-foreground">Detectadas automaticamente (incluindo playlists fora da rede)</p>
          </div>
          {attribution.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma detecção ainda.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-left font-medium px-4 py-3">Playlist</th>
                    <th className="text-left font-medium px-4 py-3">Owner</th>
                    <th className="text-left font-medium px-4 py-3">Pos atual</th>
                    <th className="text-right font-medium px-4 py-3">Plays 7d</th>
                    <th className="text-left font-medium px-4 py-3">Observações</th>
                    <th className="text-left font-medium px-4 py-3">Visto por último</th>
                  </tr>
                </thead>
                <tbody>
                  {attribution.slice(0, 50).map((a) => (
                    <tr key={a.spotify_playlist_id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        {a.spotify_url ? (
                          <a href={a.spotify_url} target="_blank" rel="noreferrer" className="font-medium text-foreground hover:text-primary inline-flex items-center gap-1">
                            {a.name} <ExternalLink className="h-3 w-3 opacity-60" />
                          </a>
                        ) : (
                          <span className="font-medium text-foreground">{a.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{a.owner ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{a.current_position != null ? `#${a.current_position}` : "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{fmt(a.current_plays_7d)}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{a.observations}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{rel(a.last_seen_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* DISTRIBUIÇÕES — log de cada execução de "Distribuir" para esta música */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-5 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><History className="h-4 w-4" /> Distribuições</h3>
            <p className="text-xs text-muted-foreground">Histórico de cada rodada de distribuição</p>
          </div>
          {batches.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma distribuição ainda.</div>
          ) : (
            <>
              {/* MOBILE: cards */}
              <div className="sm:hidden divide-y divide-border">
                {batches.map((bt) => (
                  <div key={bt.id} className="p-4">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
                      {new Date(bt.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="grid grid-cols-4 gap-[1px] bg-border border border-border rounded-lg overflow-hidden">
                      <div className="bg-black/30 px-1.5 py-2 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Elegíveis</div>
                        <div className="text-sm font-bold tabular-nums text-foreground">{bt.total_eligible_playlists}</div>
                      </div>
                      <div className="bg-black/30 px-1.5 py-2 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Já lá</div>
                        <div className="text-sm font-bold tabular-nums text-muted-foreground">{bt.skipped_already_present}</div>
                      </div>
                      <div className="bg-black/30 px-1.5 py-2 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">S/ vaga</div>
                        <div className="text-sm font-bold tabular-nums text-muted-foreground">{bt.skipped_no_capacity}</div>
                      </div>
                      <div className="bg-black/30 px-1.5 py-2 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Criadas</div>
                        <div className="text-sm font-bold tabular-nums text-[#1DB954]">{bt.placements_created}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* DESKTOP: tabela */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="text-left font-medium px-4 py-3">Quando</th>
                      <th className="text-right font-medium px-4 py-3">Elegíveis</th>
                      <th className="text-right font-medium px-4 py-3">Já presente</th>
                      <th className="text-right font-medium px-4 py-3">Sem vaga</th>
                      <th className="text-right font-medium px-4 py-3">Criadas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((bt) => (
                      <tr key={bt.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{new Date(bt.created_at).toLocaleString("pt-BR")}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{bt.total_eligible_playlists}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{bt.skipped_already_present}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{bt.skipped_no_capacity}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-foreground">{bt.placements_created}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </PageContainer>
    </>
  );
}
