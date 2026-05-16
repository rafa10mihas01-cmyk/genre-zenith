import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity, TrendingUp, TrendingDown, Gauge, Sparkles, Brain, Handshake,
  ArrowRight, ListMusic, AlertTriangle, ShieldAlert, Clock,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { KpiBig } from "@/components/KpiBig";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { formatNumber, timeAgo } from "@/lib/format";

/* ============================================================
 * Tipos
 * ============================================================ */
type Period = 7 | 30 | 90;

type Managed = {
  id: string;
  name: string;
  followers: number;
  spotify_playlist_id: string;
  canonical_playlist_id: string | null;
  last_diagnosis_at: string | null;
};

type Snap = { spotify_playlist_id: string; followers: number; collected_at: string };

type Brain = { playlist_id: string; health_trend: string; last_calculated_at: string };

type Mover = { id: string; name: string; delta: number; followers: number };

type ModuleHealth = {
  label: string;
  to: string;
  icon: any;
  status: "ok" | "warn" | "crit" | "idle";
  primary: string;
  secondary: string;
};

/* ============================================================
 * Página
 * ============================================================ */
export default function Executivo() {
  const [period, setPeriod] = useState<Period>(7);
  const [loading, setLoading] = useState(true);

  const [managed, setManaged] = useState<Managed[]>([]);
  const [snapsCurr, setSnapsCurr] = useState<Snap[]>([]);
  const [snapsPrev, setSnapsPrev] = useState<Snap[]>([]);
  const [brains, setBrains] = useState<Brain[]>([]);

  const [dealsPend, setDealsPend] = useState(0);
  const [dealsTotal, setDealsTotal] = useState(0);
  const [fraudOpen, setFraudOpen] = useState(0);
  const [lastCollectAt, setLastCollectAt] = useState<string | null>(null);
  const [curatorsActive, setCuratorsActive] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const ms = period * 86400000;
      const currStart = new Date(Date.now() - ms).toISOString();
      const prevStart = new Date(Date.now() - 2 * ms).toISOString();
      const prevEnd = currStart;

      const [
        mRes, snapCurrRes, snapPrevRes, brainRes,
        dPendRes, dTotRes, fraudRes, logRes, curRes,
      ] = await Promise.all([
        supabase
          .from("managed_playlists")
          .select("id,name,followers,spotify_playlist_id,canonical_playlist_id,last_diagnosis_at")
          .is("archived_at", null),
        supabase
          .from("playlist_metrics_snapshots")
          .select("spotify_playlist_id,followers,collected_at")
          .gte("collected_at", currStart)
          .order("collected_at", { ascending: true }),
        supabase
          .from("playlist_metrics_snapshots")
          .select("spotify_playlist_id,followers,collected_at")
          .gte("collected_at", prevStart)
          .lt("collected_at", prevEnd)
          .order("collected_at", { ascending: true }),
        supabase
          .from("playlist_brain")
          .select("playlist_id,health_trend,last_calculated_at"),
        supabase.from("curator_deals").select("id", { count: "exact", head: true })
          .in("state", ["awaiting_playlists", "awaiting_review", "pending"]),
        supabase.from("curator_deals").select("id", { count: "exact", head: true }),
        supabase.from("curator_fraud_alerts").select("id", { count: "exact", head: true })
          .eq("status", "open"),
        supabase.from("collection_logs").select("created_at")
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("curators").select("id", { count: "exact", head: true })
          .is("archived_at", null),
      ]);

      setManaged((mRes.data ?? []) as Managed[]);
      setSnapsCurr((snapCurrRes.data ?? []) as Snap[]);
      setSnapsPrev((snapPrevRes.data ?? []) as Snap[]);
      setBrains((brainRes.data ?? []) as Brain[]);
      setDealsPend(dPendRes.count ?? 0);
      setDealsTotal(dTotRes.count ?? 0);
      setFraudOpen(fraudRes.count ?? 0);
      setLastCollectAt((logRes.data as any)?.created_at ?? null);
      setCuratorsActive(curRes.count ?? 0);
      setLoading(false);
    })();
  }, [period]);

  /* ---- Métricas derivadas ---- */
  const metrics = useMemo(() => {
    const mgdIds = new Set(managed.map(m => m.spotify_playlist_id));
    const filterMgd = (s: Snap) => mgdIds.has(s.spotify_playlist_id);

    const firstLast = (snaps: Snap[]) => {
      const m = new Map<string, { first: number; last: number }>();
      for (const s of snaps.filter(filterMgd)) {
        const cur = m.get(s.spotify_playlist_id);
        if (!cur) m.set(s.spotify_playlist_id, { first: s.followers, last: s.followers });
        else cur.last = s.followers;
      }
      return m;
    };

    const currMap = firstLast(snapsCurr);
    const prevMap = firstLast(snapsPrev);

    let growthCurr = 0;
    for (const v of currMap.values()) growthCurr += v.last - v.first;
    let growthPrev = 0;
    for (const v of prevMap.values()) growthPrev += v.last - v.first;

    const totalFollowers = managed.reduce((s, m) => s + (m.followers || 0), 0);
    const totalPlaylists = managed.length;

    // velocity (seguidores/dia)
    const velocity = growthCurr / period;
    const velocityPrev = growthPrev / period;

    // Success rate baseado em playlist_brain (via canonical_playlist_id)
    const brainByPid = new Map(brains.map(b => [b.playlist_id, b]));
    let crescendo = 0, encolhendo = 0, estavel = 0, semDiag = 0;
    for (const m of managed) {
      const b = m.canonical_playlist_id ? brainByPid.get(m.canonical_playlist_id) : null;
      if (!b || b.health_trend === "sem_dados" || b.health_trend === "novo") semDiag++;
      else if (b.health_trend === "crescendo") crescendo++;
      else if (b.health_trend === "encolhendo") encolhendo++;
      else estavel++;
    }
    const successRate = totalPlaylists > 0 ? (crescendo / totalPlaylists) * 100 : 0;

    // Top movers
    const moverList: Mover[] = managed
      .map(m => {
        const s = currMap.get(m.spotify_playlist_id);
        if (!s) return null;
        return { id: m.id, name: m.name, followers: m.followers, delta: s.last - s.first };
      })
      .filter((x): x is Mover => !!x && x.delta !== 0);
    const topUp = [...moverList].filter(x => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
    const topDown = [...moverList].filter(x => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3);

    // Sparkline diário: soma de followers (last seen no dia) para todas managed
    const dayMap = new Map<string, Map<string, number>>(); // day -> pid -> lastFollowers
    for (const s of snapsCurr.filter(filterMgd)) {
      const day = s.collected_at.slice(0, 10);
      if (!dayMap.has(day)) dayMap.set(day, new Map());
      dayMap.get(day)!.set(s.spotify_playlist_id, s.followers);
    }
    // forward-fill last known followers per playlist across days
    const days = Array.from(dayMap.keys()).sort();
    const lastSeen = new Map<string, number>();
    const series: { day: string; total: number }[] = [];
    for (const day of days) {
      for (const [pid, v] of dayMap.get(day)!) lastSeen.set(pid, v);
      let sum = 0;
      for (const v of lastSeen.values()) sum += v;
      series.push({ day, total: sum });
    }

    // Freshness do cérebro de playlists (diagnóstico < 7d)
    const sevenAgo = Date.now() - 7 * 86400000;
    const freshCount = managed.filter(m =>
      m.last_diagnosis_at && new Date(m.last_diagnosis_at).getTime() > sevenAgo
    ).length;

    return {
      totalFollowers, totalPlaylists,
      growthCurr, growthPrev,
      velocity, velocityPrev,
      successRate,
      crescendo, encolhendo, estavel, semDiag,
      topUp, topDown,
      series,
      freshCount,
    };
  }, [managed, snapsCurr, snapsPrev, brains, period]);

  /* ---- Δ helper ---- */
  const deltaPct = (curr: number, prev: number): { v: number; up: boolean } | null => {
    if (prev === 0) return null;
    const v = ((curr - prev) / Math.abs(prev)) * 100;
    return { v, up: v >= 0 };
  };
  const dGrowth = deltaPct(metrics.growthCurr, metrics.growthPrev);
  const dVel = deltaPct(metrics.velocity, metrics.velocityPrev);

  /* ---- Módulos ---- */
  const freshRatio = metrics.totalPlaylists > 0 ? metrics.freshCount / metrics.totalPlaylists : 0;
  const modules: ModuleHealth[] = [
    {
      label: "Cérebro de playlists",
      to: "/cerebro",
      icon: Brain,
      status: metrics.totalPlaylists === 0 ? "idle"
        : freshRatio >= 0.7 ? "ok" : freshRatio >= 0.4 ? "warn" : "crit",
      primary: `${metrics.freshCount}/${metrics.totalPlaylists}`,
      secondary: `diagnosticadas < 7d · ${curatorsActive} curadores ativos`,
    },
    {
      label: "Performance",
      to: "/performance",
      icon: TrendingUp,
      status: metrics.totalPlaylists === 0 ? "idle"
        : metrics.successRate >= 60 ? "ok"
        : metrics.successRate >= 30 ? "warn" : "crit",
      primary: `${metrics.successRate.toFixed(0)}%`,
      secondary: `${metrics.crescendo} crescendo · ${metrics.encolhendo} em queda · ${metrics.estavel} estável`,
    },
    {
      label: "Catálogo",
      to: "/catalogo",
      icon: ListMusic,
      status: metrics.totalPlaylists === 0 ? "idle" : "ok",
      primary: `${metrics.totalPlaylists}`,
      secondary: "playlists gerenciadas ativas",
    },
    {
      label: "Playlist Deals",
      to: "/playlist-deals",
      icon: Handshake,
      status: dealsPend === 0 ? "ok" : dealsPend > 5 ? "crit" : "warn",
      primary: `${dealsPend}`,
      secondary: `aguardando ação · ${dealsTotal} no total`,
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Painel executivo"
        subtitle="Resumir saúde da operação em 1 tela"
        actions={
          <div className="flex items-center gap-2">
            <PeriodSelector value={period} onChange={setPeriod} />
            <Button asChild variant="outline" size="sm">
              <Link to="/">Ir para Hoje<ArrowRight className="h-4 w-4 ml-2" /></Link>
            </Button>
          </div>
        }
      />

      {/* ZONA 1 — KPIs north-star com Δ vs período anterior */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBig
          label="Seguidores totais"
          value={formatNumber(metrics.totalFollowers)}
          icon={Activity}
          hint={`${metrics.totalPlaylists} playlists ativas`}
          loading={loading}
        />
        <KpiBig
          label={`Ganhos em ${period}d`}
          value={formatNumber(metrics.growthCurr)}
          icon={TrendingUp}
          tone={metrics.growthCurr > 0 ? "success" : metrics.growthCurr < 0 ? "destructive" : "default"}
          hint={dGrowth ? `${dGrowth.up ? "+" : ""}${dGrowth.v.toFixed(0)}% vs período anterior` : "Sem comparativo"}
          loading={loading}
        />
        <KpiBig
          label="Velocidade média"
          value={`${metrics.velocity >= 0 ? "+" : ""}${metrics.velocity.toFixed(1)}/dia`}
          icon={Gauge}
          tone="primary"
          hint={dVel ? `${dVel.up ? "+" : ""}${dVel.v.toFixed(0)}% vs período anterior` : "Sem comparativo"}
          loading={loading}
        />
        <KpiBig
          label="Taxa de sucesso"
          value={`${metrics.successRate.toFixed(0)}%`}
          icon={Sparkles}
          tone={metrics.successRate >= 60 ? "success" : metrics.successRate >= 30 ? "warning" : "destructive"}
          hint={`${metrics.crescendo}/${metrics.totalPlaylists} em crescimento`}
          loading={loading}
        />
      </div>

      {/* ZONA 2 — Tendência */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
            Tendência de seguidores
          </h2>
          <span className="text-[11px] text-muted-foreground">
            Últimos {period} dias
          </span>
        </div>
        <Card className="p-5">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : metrics.series.length < 2 ? (
            <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
              Dados insuficientes para o período.
            </div>
          ) : (
            <Sparkline series={metrics.series} />
          )}
        </Card>
      </section>

      {/* ZONA 3 — Saúde por módulo */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
            Saúde por módulo
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {lastCollectAt ? `Última coleta ${timeAgo(lastCollectAt)}` : "Sem coleta registrada"}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {modules.map(m => <ModuleHealthCard key={m.label} m={m} loading={loading} />)}
        </div>
      </section>

      {/* ZONA 4 — Top movimentos */}
      <section className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
          Top movimentos em {period}d
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MoversCard
            title="Maiores crescimentos"
            icon={TrendingUp}
            tone="success"
            items={metrics.topUp}
            loading={loading}
            emptyText="Nenhuma playlist cresceu no período."
          />
          <MoversCard
            title="Maiores quedas"
            icon={TrendingDown}
            tone="destructive"
            items={metrics.topDown}
            loading={loading}
            emptyText="Nenhuma playlist em queda no período."
          />
        </div>
      </section>

      {/* ZONA 5 — Pulso operacional */}
      <section className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
          Pulso operacional
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PulseCard
            icon={Clock}
            label="Última coleta"
            value={lastCollectAt ? timeAgo(lastCollectAt) : "—"}
            tone={lastCollectAt && Date.now() - new Date(lastCollectAt).getTime() < 6 * 3600000 ? "ok" : "warn"}
            loading={loading}
          />
          <PulseCard
            icon={ShieldAlert}
            label="Alertas de fraude abertos"
            value={String(fraudOpen)}
            tone={fraudOpen === 0 ? "ok" : "crit"}
            loading={loading}
            to="/playlist-deals"
          />
          <PulseCard
            icon={AlertTriangle}
            label="Sem diagnóstico recente"
            value={String(metrics.semDiag)}
            tone={metrics.semDiag === 0 ? "ok" : metrics.semDiag > 5 ? "crit" : "warn"}
            loading={loading}
            to="/catalogo"
          />
        </div>
      </section>
    </PageContainer>
  );
}

/* ============================================================
 * Subcomponentes
 * ============================================================ */
function PeriodSelector({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const opts: Period[] = [7, 30, 90];
  return (
    <div className="inline-flex rounded-full border border-border bg-card p-0.5">
      {opts.map(p => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={cn(
            "px-3 h-7 text-xs font-semibold rounded-full transition-colors",
            value === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {p}d
        </button>
      ))}
    </div>
  );
}

function Sparkline({ series }: { series: { day: string; total: number }[] }) {
  const W = 800, H = 120, P = 8;
  const xs = series.map((_, i) => P + (i * (W - 2 * P)) / Math.max(series.length - 1, 1));
  const ys = (() => {
    const vals = series.map(s => s.total);
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    return vals.map(v => H - P - ((v - min) / range) * (H - 2 * P));
  })();
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${d} L${xs[xs.length - 1].toFixed(1)},${H - P} L${xs[0].toFixed(1)},${H - P} Z`;
  const first = series[0].total, last = series[series.length - 1].total;
  const diff = last - first;
  const up = diff >= 0;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-2xl font-bold tabular-nums">{formatNumber(last)}</div>
          <div className="text-[11px] text-muted-foreground">seguidores no fim do período</div>
        </div>
        <div className={cn("text-sm font-semibold tabular-nums", up ? "text-success" : "text-destructive")}>
          {up ? "+" : ""}{formatNumber(diff)}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.25" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#spark-fill)" />
        <path d={d} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

const STATUS_DOT: Record<ModuleHealth["status"], string> = {
  ok: "bg-success", warn: "bg-warning", crit: "bg-destructive", idle: "bg-muted-foreground",
};
const STATUS_LABEL: Record<ModuleHealth["status"], string> = {
  ok: "Saudável", warn: "Atenção", crit: "Crítico", idle: "Sem dados",
};
const STATUS_TEXT: Record<ModuleHealth["status"], string> = {
  ok: "text-success", warn: "text-warning", crit: "text-destructive", idle: "text-muted-foreground",
};

function ModuleHealthCard({ m, loading }: { m: ModuleHealth; loading: boolean }) {
  return (
    <Link to={m.to} className="nx-card-hover p-5 flex flex-col gap-3 group">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <m.icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold text-foreground truncate">{m.label}</span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
      </div>
      {loading ? (
        <Skeleton className="h-7 w-20" />
      ) : (
        <div className="text-2xl font-bold tabular-nums leading-tight">{m.primary}</div>
      )}
      <div className="flex items-center justify-between gap-2 mt-auto">
        <span className="text-[11px] text-muted-foreground truncate flex-1">{m.secondary}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[m.status])} />
          <span className={cn("text-[10px] uppercase tracking-wide font-bold", STATUS_TEXT[m.status])}>
            {STATUS_LABEL[m.status]}
          </span>
        </div>
      </div>
    </Link>
  );
}

function MoversCard({
  title, icon: Icon, tone, items, loading, emptyText,
}: {
  title: string; icon: any; tone: "success" | "destructive";
  items: Mover[]; loading: boolean; emptyText: string;
}) {
  const toneClass = tone === "success" ? "text-success" : "text-destructive";
  return (
    <div className="nx-card p-5 flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", toneClass)} />
        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
          {title}
        </span>
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">{emptyText}</div>
      ) : (
        <ul className="divide-y divide-border/50">
          {items.map(i => (
            <li key={i.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{i.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {formatNumber(i.followers)} seguidores
                </div>
              </div>
              <span className={cn("text-sm font-bold tabular-nums shrink-0", toneClass)}>
                {i.delta > 0 ? "+" : ""}{formatNumber(i.delta)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PulseCard({
  icon: Icon, label, value, tone, loading, to,
}: {
  icon: any; label: string; value: string;
  tone: "ok" | "warn" | "crit"; loading: boolean; to?: string;
}) {
  const inner = (
    <div className="nx-card p-4 flex items-center gap-3 h-full">
      <div className={cn(
        "h-9 w-9 rounded-full flex items-center justify-center shrink-0",
        tone === "ok" && "bg-success/10 text-success",
        tone === "warn" && "bg-warning/10 text-warning",
        tone === "crit" && "bg-destructive/10 text-destructive",
      )}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
          {label}
        </div>
        {loading ? (
          <Skeleton className="h-5 w-16 mt-1" />
        ) : (
          <div className="text-base font-bold tabular-nums truncate">{value}</div>
        )}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block hover:opacity-90 transition-opacity">{inner}</Link> : inner;
}
