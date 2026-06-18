import { useMemo, useState } from "react";
import {
  Users,
  DollarSign,
  Target as TargetIcon,
  TrendingUp,
  ShieldAlert,
  Archive,
  ArchiveRestore,
  Pencil,
  AlertTriangle,
  Music2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { KpiBig } from "@/components/KpiBig";
import {
  computeCuratorStats,
  type CuratorDeal,
  type CuratorDealLog,
  type CuratorDealSong,
  type CuratorPlaylist,
  type CuratorDealProgress,
} from "@/lib/curatorDealsUtils";
import type {
  Curator,
  CuratorBalance,
  CuratorFraudAlert,
  NewCuratorInput,
} from "@/hooks/useCuratorDeals";
import { useUserRole } from "@/hooks/useUserRole";
import { useCuratorBrain, useCuratorBrainsByIds, useRecalcCuratorBrain } from "@/hooks/useCuratorBrain";
import { Brain, RefreshCw, Lightbulb, AlertCircle, CheckCircle2, Activity } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type Props = {
  deals: CuratorDeal[];
  logs: CuratorDealLog[];
  playlists: CuratorPlaylist[];
  songs?: CuratorDealSong[];
  curators?: Curator[];
  balances?: CuratorBalance[];
  alerts?: CuratorFraudAlert[];
  loading: boolean;
  progressByDeal?: Record<string, CuratorDealProgress>;
  onUpdateCurator?: (id: string, input: Partial<NewCuratorInput>) => Promise<void>;
  onArchiveCurator?: (id: string, archive?: boolean) => Promise<void>;
};

type CuratorRow = {
  name: string;
  dealsCount: number;
  totalCost: number;
  totalEarned: number;
  totalTarget: number;
  costPerPlay: number | null;
  deliveryPct: number;
  avgScore: number;
  avgLegitShare: number;
  alertsOpen: number;
  alertsHigh: number;
};

const formatBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(v);

const formatCostPerPlay = (v: number | null) => {
  if (v === null || !isFinite(v)) return "—";
  const opts =
    v < 0.01
      ? { minimumFractionDigits: 4, maximumFractionDigits: 4 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", ...opts }).format(v);
};

export function CuradoresTab({
  deals,
  logs,
  playlists,
  songs = [],
  curators = [],
  balances = [],
  alerts = [],
  loading,
  progressByDeal = {},
  onUpdateCurator,
  onArchiveCurator,
}: Props) {
  const { isAdmin } = useUserRole();
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editTarget, setEditTarget] = useState<Curator | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Curator | null>(null);
  const [brainTarget, setBrainTarget] = useState<Curator | null>(null);

  const balanceById = useMemo(() => {
    const m = new Map<string, CuratorBalance>();
    for (const b of balances) m.set(b.curator_id, b);
    return m;
  }, [balances]);

  // Mapa curator_id -> deals (ativos = sem closed_at)
  const dealsByCurator = useMemo(() => {
    const m = new Map<string, CuratorDeal[]>();
    for (const d of deals) {
      if (!d.curator_id) continue;
      const arr = m.get(d.curator_id) ?? [];
      arr.push(d);
      m.set(d.curator_id, arr);
    }
    return m;
  }, [deals]);

  // Mapa deal_id -> songs
  const songsByDeal = useMemo(() => {
    const m = new Map<string, CuratorDealSong[]>();
    for (const s of songs) {
      const arr = m.get(s.deal_id) ?? [];
      arr.push(s);
      m.set(s.deal_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.position - b.position);
    return m;
  }, [songs]);

  // Mapa song_id -> total_plays (último log)
  const playsBySong = useMemo(() => {
    const m = new Map<string, number>();
    const seen = new Set<string>();
    // Logs vêm ordenados desc por created_at no hook
    for (const l of logs) {
      if (!l.song_id) continue;
      if (seen.has(l.song_id)) continue;
      seen.add(l.song_id);
      m.set(l.song_id, Number(l.total_plays ?? 0));
    }
    return m;
  }, [logs]);

  // Linhas da tabela histórica (mantida como antes)
  const { rows, totals } = useMemo(() => {
    const dealAlerts = new Map<string, { open: number; high: number }>();
    for (const a of alerts) {
      if (a.status !== "open") continue;
      const cur = dealAlerts.get(a.deal_id) ?? { open: 0, high: 0 };
      cur.open += 1;
      if (a.severity === "high") cur.high += 1;
      dealAlerts.set(a.deal_id, cur);
    }

    type Acc = CuratorRow & {
      _scoreNum: number;
      _scoreDen: number;
      _legitNum: number;
      _legitDen: number;
    };
    const map = new Map<string, Acc>();
    let totalCost = 0;
    let totalEarned = 0;
    let totalTarget = 0;
    let scoreNum = 0,
      scoreDen = 0;
    let totalAlertsOpen = 0;
    let totalAlertsHigh = 0;

    for (const d of deals) {
      const name = (d.curator_name ?? "").trim() || "—";
      const cost = Number(d.cost ?? 0) || 0;
      const target = Number(d.target_plays ?? 0) || 0;
      const stats = computeCuratorStats(d, logs, playlists, progressByDeal[d.id] ?? null);
      const w = Math.max(target, 1);
      const aCount = dealAlerts.get(d.id) ?? { open: 0, high: 0 };

      const row: Acc =
        map.get(name) ?? {
          name,
          dealsCount: 0,
          totalCost: 0,
          totalEarned: 0,
          totalTarget: 0,
          costPerPlay: null,
          deliveryPct: 0,
          avgScore: 0,
          avgLegitShare: 1,
          alertsOpen: 0,
          alertsHigh: 0,
          _scoreNum: 0,
          _scoreDen: 0,
          _legitNum: 0,
          _legitDen: 0,
        };
      row.dealsCount += 1;
      row.totalCost += cost;
      row.totalEarned += stats.earned;
      row.totalTarget += target;
      row._scoreNum += stats.score * w;
      row._scoreDen += w;
      row._legitNum += stats.legitShare * w;
      row._legitDen += w;
      row.alertsOpen += aCount.open;
      row.alertsHigh += aCount.high;
      map.set(name, row);

      totalCost += cost;
      totalEarned += stats.earned;
      totalTarget += target;
      scoreNum += stats.score * w;
      scoreDen += w;
      totalAlertsOpen += aCount.open;
      totalAlertsHigh += aCount.high;
    }

    const rows: CuratorRow[] = Array.from(map.values()).map((r) => {
      const denom = r.totalEarned > 0 ? r.totalEarned : r.totalTarget;
      return {
        name: r.name,
        dealsCount: r.dealsCount,
        totalCost: r.totalCost,
        totalEarned: r.totalEarned,
        totalTarget: r.totalTarget,
        costPerPlay: denom > 0 ? r.totalCost / denom : null,
        deliveryPct: r.totalTarget > 0 ? Math.round((r.totalEarned / r.totalTarget) * 100) : 0,
        avgScore: r._scoreDen > 0 ? Math.round(r._scoreNum / r._scoreDen) : 0,
        avgLegitShare: r._legitDen > 0 ? r._legitNum / r._legitDen : 1,
        alertsOpen: r.alertsOpen,
        alertsHigh: r.alertsHigh,
      };
    });
    rows.sort((a, b) => b.avgScore - a.avgScore);

    return {
      rows,
      totals: {
        curators: map.size,
        totalCost,
        totalEarned,
        totalTarget,
        avgCostPerPlay:
          totalEarned > 0
            ? totalCost / totalEarned
            : totalTarget > 0
            ? totalCost / totalTarget
            : null,
        deliveryPct: totalTarget > 0 ? Math.round((totalEarned / totalTarget) * 100) : 0,
        avgScore: scoreDen > 0 ? Math.round(scoreNum / scoreDen) : 0,
        alertsOpen: totalAlertsOpen,
        alertsHigh: totalAlertsHigh,
      },
    };
    // progressByDeal não é dependência direta do agregado; reagimos só às fontes brutas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals, logs, playlists, alerts]);

  // Curadores visíveis
  const visibleCurators = useMemo(() => {
    return curators
      .filter((c) => (showArchived ? !!c.archived_at : !c.archived_at))
      .sort((a, b) => {
        const ba = balanceById.get(a.id);
        const bb = balanceById.get(b.id);
        const ra = ba?.remaining_plays ?? a.purchased_plays;
        const rb = bb?.remaining_plays ?? b.purchased_plays;
        return rb - ra;
      });
  }, [curators, showArchived, balanceById]);

  const curatorIds = useMemo(() => visibleCurators.map((c) => c.id), [visibleCurators]);
  const { data: brainsMap = {} } = useCuratorBrainsByIds(curatorIds);
  const recalcBrain = useRecalcCuratorBrain();

  const overbookedCount = useMemo(
    () => balances.filter((b) => b.overbooked_plays > 0 && !b.archived_at).length,
    [balances],
  );

  const isEmptyAll = !loading && deals.length === 0 && curators.length === 0;

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* KPIs gerais */}
      <section className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiBig
          icon={Users}
          label="Curadores"
          value={formatNumber(curators.filter((c) => !c.archived_at).length || totals.curators)}
          hint={
            curators.length > 0
              ? `${curators.filter((c) => c.archived_at).length} arquivado(s)`
              : "Distintos com deals"
          }
          loading={loading && deals.length === 0}
        />
        <KpiBig
          icon={DollarSign}
          label="Total investido"
          value={formatBRL(
            balances.reduce((acc, b) => acc + Number(b.total_cost ?? 0), 0) || totals.totalCost,
          )}
          hint={`${deals.length} ${deals.length === 1 ? "deal" : "deals"}`}
          loading={loading && deals.length === 0}
        />
        <KpiBig
          icon={TargetIcon}
          label="Plays entregues"
          value={formatNumber(totals.totalEarned)}
          hint={totals.totalTarget > 0 ? `${totals.deliveryPct}% das metas` : "Sem metas"}
          tone={
            totals.deliveryPct >= 80
              ? "success"
              : totals.deliveryPct >= 40
              ? "primary"
              : "default"
          }
          loading={loading && deals.length === 0}
        />
        <KpiBig
          icon={TrendingUp}
          label="Score médio"
          value={`${totals.avgScore}/100`}
          hint="Prazo + qualidade do tráfego"
          tone={
            totals.avgScore >= 80 ? "success" : totals.avgScore >= 50 ? "primary" : "default"
          }
          loading={loading && deals.length === 0}
        />
        <KpiBig
          icon={isAdmin && overbookedCount > 0 ? AlertTriangle : ShieldAlert}
          label={isAdmin && overbookedCount > 0 ? "Saldos estourados" : "Alertas anti-fraude"}
          value={
            isAdmin && overbookedCount > 0
              ? formatNumber(overbookedCount)
              : formatNumber(totals.alertsOpen)
          }
          hint={
            isAdmin && overbookedCount > 0
              ? "Plays consumidos > comprados"
              : totals.alertsHigh > 0
              ? `${totals.alertsHigh} de severidade alta`
              : "Nenhum aberto"
          }
          tone={
            isAdmin && overbookedCount > 0
              ? "default"
              : totals.alertsHigh > 0
              ? "default"
              : totals.alertsOpen > 0
              ? "primary"
              : "success"
          }
          loading={loading && deals.length === 0}
        />
        <KpiBig
          icon={DollarSign}
          label="Custo por play"
          value={(() => {
            const totalCost = balances.reduce((acc, b) => acc + Number(b.total_cost ?? 0), 0) || totals.totalCost;
            if (!totals.totalEarned || !totalCost) return 0;
            const cpp = totalCost / totals.totalEarned;
            return `R$ ${cpp.toFixed(4)}`;
          })()}
          hint="Investido ÷ plays entregues"
          loading={loading && deals.length === 0}
        />
      </section>

      {/* Saldos por curador */}
      {curators.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight">Saldo dos curadores</h3>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Plays comprados, consumidos e restantes por curador
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {showArchived ? "Ver ativos" : "Ver arquivados"}
            </button>
          </div>

          {visibleCurators.length === 0 ? (
            <div className="nx-card">
              <div className="py-8 text-center text-sm text-muted-foreground">
                {showArchived ? "Nenhum curador arquivado" : "Nenhum curador ativo"}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleCurators.map((c) => {
                const bal = balanceById.get(c.id);
                const purchased = bal?.purchased_plays ?? c.purchased_plays ?? 0;
                const consumed = bal?.consumed_plays ?? 0;
                const remaining = bal?.remaining_plays ?? purchased;
                const overbooked = bal?.overbooked_plays ?? 0;
                const cost = Number(bal?.total_cost ?? c.total_cost ?? 0);
                const consumedPct =
                  purchased > 0 ? Math.min(100, Math.round((consumed / purchased) * 100)) : 0;
                const cdeals = (dealsByCurator.get(c.id) ?? []).filter((d) => !d.closed_at);
                const isExpanded = expanded.has(c.id);

                const brain = brainsMap[c.id] as
                  | {
                      trust_score: number;
                      confidence_score: number;
                      delivery_rate_pct: number | null;
                      on_time_rate_pct: number | null;
                      signals: Array<{ code: string; severity: string; message: string }>;
                    }
                  | undefined;
                const trust = brain?.trust_score ?? null;
                const sigCount = brain?.signals?.length ?? 0;
                const highSigs = brain?.signals?.filter((s) => s.severity === "high").length ?? 0;
                const trustTone =
                  trust === null
                    ? "muted"
                    : trust >= 75
                    ? "success"
                    : trust >= 50
                    ? "primary"
                    : "destructive";

                return (
                  <article
                    key={c.id}
                    className={cn(
                      "rounded-2xl overflow-hidden border border-border/60 transition-all duration-200",
                      "hover:border-foreground/25 hover:-translate-y-[1px]",
                      "hover:shadow-[0_18px_40px_-18px_rgba(0,0,0,0.85),0_0_32px_-8px_hsl(141_76%_48%_/_0.18)]",
                      "bg-[linear-gradient(180deg,rgba(255,255,255,0.025)_0%,transparent_40%),hsl(var(--card))]",
                      c.archived_at && "opacity-70",
                    )}
                  >
                    <div className="p-5 flex flex-col gap-4">
                      {/* Header: avatar + nome + status */}
                      <div className="flex items-start gap-3 min-w-0 pb-1">
                        <div className="h-11 w-11 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-[14px] font-bold text-primary shrink-0">
                          {c.name
                            .split(/\s+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((s) => s[0]?.toUpperCase())
                            .join("") || <Users className="h-5 w-5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1">
                            Curador
                          </div>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[18px] font-semibold tracking-tight text-foreground truncate leading-tight">
                              {c.name}
                            </span>
                            {isAdmin && overbooked > 0 && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-destructive/15 text-destructive shrink-0">
                                <AlertTriangle className="h-3 w-3" />
                                Estourado
                              </span>
                            )}
                            {c.archived_at && (
                              <span className="inline-flex text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                                Arquivado
                              </span>
                            )}
                          </div>
                          {c.contact && (
                            <div className="text-[12px] text-muted-foreground mt-0.5 truncate">
                              {c.contact}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {onUpdateCurator && !c.archived_at && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setEditTarget(c)}
                              title="Editar curador"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {onArchiveCurator && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setArchiveTarget(c)}
                              title={c.archived_at ? "Restaurar" : "Arquivar"}
                            >
                              {c.archived_at ? (
                                <ArchiveRestore className="h-3.5 w-3.5" />
                              ) : (
                                <Archive className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Trust badge (curator brain) */}
                      <button
                        type="button"
                        onClick={() => setBrainTarget(c)}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-xl px-3 py-2 border text-left transition-colors hover:brightness-110",
                          trustTone === "success" && "bg-success/10 border-success/30",
                          trustTone === "primary" && "bg-primary/10 border-primary/30",
                          trustTone === "destructive" && "bg-destructive/10 border-destructive/30",
                          trustTone === "muted" && "bg-muted/30 border-border/40",
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Brain
                            className={cn(
                              "h-4 w-4 shrink-0",
                              trustTone === "success" && "text-success",
                              trustTone === "primary" && "text-primary",
                              trustTone === "destructive" && "text-destructive",
                              trustTone === "muted" && "text-muted-foreground",
                            )}
                          />
                          <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold leading-none">
                              Trust score
                            </div>
                            <div className="flex items-baseline gap-1.5 mt-1">
                              <span className="text-[16px] font-bold tabular-nums leading-none">
                                {trust !== null ? `${trust}` : "—"}
                                {trust !== null && (
                                  <span className="text-[10px] text-muted-foreground font-medium">/100</span>
                                )}
                              </span>
                              {sigCount > 0 && (
                                <span
                                  className={cn(
                                    "text-[10px] font-semibold tabular-nums",
                                    highSigs > 0 ? "text-destructive" : "text-muted-foreground",
                                  )}
                                >
                                  · {sigCount} sinal{sigCount > 1 ? "is" : ""}
                                  {highSigs > 0 ? ` (${highSigs} alto)` : ""}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label="Recalcular cérebro"
                          onClick={(e) => {
                            e.stopPropagation();
                            recalcBrain.mutate(c.id);
                          }}
                          className={cn(
                            "h-6 w-6 shrink-0 inline-flex items-center justify-center rounded-md hover:bg-foreground/10 cursor-pointer",
                            recalcBrain.isPending && "opacity-50 pointer-events-none",
                          )}
                          title="Recalcular cérebro"
                        >
                          <RefreshCw
                            className={cn("h-3 w-3", recalcBrain.isPending && "animate-spin")}
                          />
                        </span>
                      </button>


                      <div className="grid grid-cols-2 divide-x divide-border/50 rounded-xl bg-[hsl(var(--elevated))] border border-border/40">
                        <div className="px-4 py-3">
                          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1.5">
                            Plays comprados
                          </div>
                          <div className="text-[24px] font-bold tabular-nums text-foreground leading-none tracking-tight">
                            {formatNumber(purchased)}
                          </div>
                          {cost > 0 && (
                            <div className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
                              {formatBRL(cost)} total
                            </div>
                          )}
                        </div>
                        <div className="px-4 py-3">
                          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1.5">
                            Restante
                          </div>
                          <div
                            className={cn(
                              "text-[24px] font-bold tabular-nums leading-none tracking-tight",
                              overbooked > 0
                                ? "text-destructive"
                                : remaining < purchased * 0.2
                                ? "text-warning"
                                : "text-primary",
                            )}
                          >
                            {formatNumber(remaining)}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
                            {formatNumber(consumed)} consumido
                          </div>
                        </div>
                      </div>

                      {/* Progress — mesma altura/estilo do CuratorDealCard */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                            Saldo consumido
                          </span>
                          <span className="tabular-nums text-[14px] font-bold text-foreground">
                            {consumedPct}%
                          </span>
                        </div>
                        <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              "h-full transition-all rounded-full",
                              overbooked > 0
                                ? "bg-destructive"
                                : consumedPct >= 80
                                ? "bg-warning"
                                : "bg-primary",
                            )}
                            style={{ width: `${consumedPct}%` }}
                          />
                        </div>
                      </div>

                      {/* Toggle músicas ativas */}
                      {cdeals.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(c.id)}
                          className="w-full flex items-center justify-between text-[11px] text-muted-foreground hover:text-foreground transition-colors border-t border-border/40 pt-2.5"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <Music2 className="h-3.5 w-3.5 text-primary" />
                            <span className="tabular-nums font-semibold text-foreground">
                              {cdeals.reduce(
                                (n, d) => n + (songsByDeal.get(d.id)?.length ?? 0),
                                0,
                              )}
                            </span>{" "}
                            música(s) ativa(s)
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>

                    {/* Lista de músicas */}
                    {isExpanded && cdeals.length > 0 && (
                      <div className="border-t border-border/40 bg-muted/20 px-5 py-3 space-y-2">
                        {cdeals.flatMap((d) => {
                          const ss = songsByDeal.get(d.id) ?? [];
                          return ss.map((s) => {
                            const target = Number(s.target_plays ?? 0);
                            const earned = playsBySong.get(s.id) ?? 0;
                            const baseline = Number(s.baseline_plays ?? 0);
                            const delta = Math.max(0, earned - baseline);
                            const pct =
                              target > 0 ? Math.min(100, Math.round((delta / target) * 100)) : 0;
                            return (
                              <div key={s.id} className="text-[12px]">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate font-medium">{s.song_name}</span>
                                  <span className="tabular-nums text-muted-foreground shrink-0">
                                    {formatNumber(delta)} / {formatNumber(target)}
                                  </span>
                                </div>
                                <div className="h-1 rounded-full bg-muted overflow-hidden mt-1">
                                  <div
                                    className={cn(
                                      "h-full",
                                      pct >= 100
                                        ? "bg-success"
                                        : pct >= 60
                                        ? "bg-primary"
                                        : "bg-muted-foreground/40",
                                    )}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            );
                          });
                        })}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Tabela histórica */}
      {isEmptyAll ? (
        <div className="nx-card">
          <div className="py-10 flex flex-col items-center text-center gap-3">
            <div className="h-12 w-12 rounded-full bg-elevated border border-border flex items-center justify-center">
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <div className="font-semibold">Sem curadores ainda</div>
              <div className="text-sm text-muted-foreground mt-1">
                Cadastre um deal para começar a comparar custos
              </div>
            </div>
          </div>
        </div>
      ) : rows.length > 0 ? (
        <div className="nx-card !p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight">
                Performance histórica
              </h3>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Ordenado por score (prazo + qualidade)
              </p>
            </div>
            <span className="text-[12px] text-muted-foreground">
              {rows.length} {rows.length === 1 ? "curador" : "curadores"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left px-5 py-3 font-medium">Curador</th>
                  <th className="text-right px-3 py-3 font-medium">Deals</th>
                  <th className="text-right px-3 py-3 font-medium">Investido</th>
                  <th className="text-right px-3 py-3 font-medium">Plays</th>
                  <th className="text-right px-3 py-3 font-medium">R$/play</th>
                  <th className="text-right px-3 py-3 font-medium">Legítimo</th>
                  <th className="text-right px-3 py-3 font-medium">Risco</th>
                  <th className="text-right px-5 py-3 font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isBest =
                    i === 0 && rows.length > 1 && r.avgScore >= 70 && r.alertsHigh === 0;
                  const legitPct = Math.round(r.avgLegitShare * 100);
                  return (
                    <tr
                      key={r.name}
                      className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{r.name}</span>
                          {isBest && (
                            <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                              Melhor
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-muted-foreground">
                        {r.dealsCount}
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums">
                        {formatBRL(r.totalCost)}
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums">
                        {formatNumber(r.totalEarned)}
                        {r.totalTarget > 0 && (
                          <span className="text-muted-foreground">
                            {" "}
                            / {formatNumber(r.totalTarget)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-muted-foreground">
                        {formatCostPerPlay(r.costPerPlay)}
                      </td>
                      <td className="px-3 py-3.5 text-right">
                        <span
                          className={cn(
                            "inline-flex text-[12px] font-medium tabular-nums px-2 py-0.5 rounded",
                            legitPct >= 80
                              ? "bg-success/15 text-success"
                              : legitPct >= 50
                              ? "bg-warning/15 text-warning"
                              : "bg-destructive/15 text-destructive",
                          )}
                        >
                          {legitPct}%
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-right">
                        {r.alertsOpen === 0 ? (
                          <span className="inline-flex items-center text-[12px] font-medium tabular-nums px-2 py-0.5 rounded bg-success/15 text-success">
                            ok
                          </span>
                        ) : (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-[12px] font-semibold tabular-nums px-2 py-0.5 rounded",
                              r.alertsHigh > 0
                                ? "bg-destructive/15 text-destructive"
                                : "bg-warning/15 text-warning",
                            )}
                            title={`${r.alertsOpen} alerta(s) abertos${
                              r.alertsHigh > 0 ? `, ${r.alertsHigh} de severidade alta` : ""
                            }`}
                          >
                            <ShieldAlert className="h-3 w-3" />
                            {r.alertsOpen}
                            {r.alertsHigh > 0 && (
                              <span className="text-[10px] opacity-70">
                                ({r.alertsHigh} alta)
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span
                          className={cn(
                            "inline-flex items-center text-[12px] font-semibold tabular-nums px-2 py-0.5 rounded",
                            r.avgScore >= 80
                              ? "bg-success/15 text-success"
                              : r.avgScore >= 50
                              ? "bg-primary/15 text-primary"
                              : r.avgScore >= 30
                              ? "bg-warning/15 text-warning"
                              : "bg-destructive/15 text-destructive",
                          )}
                        >
                          {r.avgScore}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Cérebro do curador */}
      <BrainDetailDialog
        curator={brainTarget}
        onClose={() => setBrainTarget(null)}
      />

      {/* Editar curador */}
      <EditCuratorDialog
        curator={editTarget}
        onClose={() => setEditTarget(null)}
        onSave={async (id, input) => {
          if (!onUpdateCurator) return;
          try {
            await onUpdateCurator(id, input);
            toast.success("Curador atualizado");
            setEditTarget(null);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao atualizar");
          }
        }}
      />

      {/* Confirmar arquivar/restaurar */}
      <AlertDialog
        open={!!archiveTarget}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archiveTarget?.archived_at ? "Restaurar curador?" : "Arquivar curador?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archiveTarget?.archived_at
                ? `${archiveTarget?.name} voltará a aparecer na lista de curadores ativos.`
                : `${archiveTarget?.name} será ocultado da lista. Os deals existentes continuam visíveis.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!archiveTarget || !onArchiveCurator) return;
                try {
                  await onArchiveCurator(archiveTarget.id, !archiveTarget.archived_at);
                  toast.success(
                    archiveTarget.archived_at ? "Curador restaurado" : "Curador arquivado",
                  );
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Erro");
                } finally {
                  setArchiveTarget(null);
                }
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================
// Dialog de edição
// ============================================================
function EditCuratorDialog({
  curator,
  onClose,
  onSave,
}: {
  curator: Curator | null;
  onClose: () => void;
  onSave: (id: string, input: Partial<NewCuratorInput>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset ao abrir
  useMemo(() => {
    if (curator) {
      setName(curator.name);
      setContact(curator.contact ?? "");
      setNotes(curator.notes ?? "");
    }
  }, [curator]);

  const handleSave = async () => {
    if (!curator) return;
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    setSaving(true);
    await onSave(curator.id, {
      name: name.trim(),
      contact: contact.trim() || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
  };

  return (
    <Dialog open={!!curator} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar curador</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="ec-name">Nome</Label>
            <Input id="ec-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ec-contact">Contato</Label>
            <Input
              id="ec-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="email, telefone, @..."
            />
          </div>
          <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Plays comprados e custo total são derivados do ledger de compras (aba Financeiro). Para ajustar saldo, use "Adicionar saldo" no fluxo de novo deal.
          </div>
          <div>
            <Label htmlFor="ec-notes">Notas</Label>
            <Textarea
              id="ec-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Dialog de detalhe do cérebro do curador
// ============================================================
function BrainDetailDialog({
  curator,
  onClose,
}: {
  curator: Curator | null;
  onClose: () => void;
}) {
  const { data: brain, isLoading } = useCuratorBrain(curator?.id);
  const recalc = useRecalcCuratorBrain();

  const sevTone = (s: string) =>
    s === "high" ? "destructive" : s === "medium" ? "warning" : "muted";

  return (
    <Dialog open={!!curator} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Cérebro · {curator?.name}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : !brain ? (
          <div className="py-10 text-center space-y-3">
            <div className="text-sm text-muted-foreground">
              Nenhum cérebro calculado ainda para este curador.
            </div>
            <Button
              size="sm"
              onClick={() => curator && recalc.mutate(curator.id)}
              disabled={recalc.isPending}
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", recalc.isPending && "animate-spin")} />
              Calcular agora
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* KPIs principais */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border border-border/40 bg-[hsl(var(--elevated))] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                  Trust
                </div>
                <div className="text-[20px] font-bold tabular-nums leading-tight">
                  {brain.trust_score}
                  <span className="text-[10px] text-muted-foreground font-medium">/100</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Confiança {brain.confidence_score}%
                </div>
              </div>
              <div className="rounded-xl border border-border/40 bg-[hsl(var(--elevated))] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                  Entrega
                </div>
                <div className="text-[20px] font-bold tabular-nums leading-tight">
                  {brain.delivery_rate_pct !== null ? `${brain.delivery_rate_pct}%` : "—"}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  No prazo: {brain.on_time_rate_pct !== null ? `${brain.on_time_rate_pct}%` : "—"}
                </div>
              </div>
              <div className="rounded-xl border border-border/40 bg-[hsl(var(--elevated))] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                  CPP médio
                </div>
                <div className="text-[20px] font-bold tabular-nums leading-tight">
                  {brain.avg_cpp !== null ? formatCostPerPlay(brain.avg_cpp) : "—"}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  ROI score {brain.roi_score ?? "—"}
                </div>
              </div>
              <div className="rounded-xl border border-border/40 bg-[hsl(var(--elevated))] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                  Capacidade
                </div>
                <div className="text-[20px] font-bold tabular-nums leading-tight">
                  {brain.capacity_avg_per_deal !== null
                    ? formatNumber(brain.capacity_avg_per_deal)
                    : "—"}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  P90:{" "}
                  {brain.capacity_p90 !== null ? formatNumber(brain.capacity_p90) : "—"}
                </div>
              </div>
            </div>

            {/* Identidade & risco */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-border/40 px-3 py-2.5 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" /> Identidade
                </div>
                <div className="text-[12px] space-y-0.5">
                  <div>
                    <span className="text-muted-foreground">Tipo:</span>{" "}
                    {brain.identity?.deal_type ?? "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Playlists:</span>{" "}
                    {brain.identity?.playlists_count ?? 0}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Alcance total:</span>{" "}
                    {formatNumber(brain.identity?.total_followers_alcance ?? 0)} seguidores
                  </div>
                  <div>
                    <span className="text-muted-foreground">Idade:</span>{" "}
                    {brain.identity?.age_days ?? 0} dias na base
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-border/40 px-3 py-2.5 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5" /> Risco & histórico
                </div>
                <div className="text-[12px] space-y-0.5">
                  <div>
                    <span className="text-muted-foreground">Deals fechados:</span>{" "}
                    {brain.reliability?.closed_deals ?? 0} /{" "}
                    {brain.reliability?.total_deals ?? 0}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Sucessos:</span>{" "}
                    {brain.reliability?.successful ?? 0} ·{" "}
                    <span className="text-muted-foreground">Falhas:</span>{" "}
                    {brain.reliability?.failed ?? 0}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total investido:</span>{" "}
                    {formatBRL(Number(brain.economics?.total_invested ?? 0))}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Alertas abertos:</span>{" "}
                    {brain.risk?.open_alerts ?? 0}
                    {(brain.risk?.high_alerts ?? 0) > 0 && (
                      <span className="text-destructive ml-1">
                        ({brain.risk?.high_alerts} alta)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Sinais */}
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" /> Sinais ({brain.signals?.length ?? 0})
              </div>
              {(!brain.signals || brain.signals.length === 0) ? (
                <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-[12px] text-success flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Nenhum sinal de risco detectado
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {brain.signals.map((s, i) => {
                    const tone = sevTone(s.severity);
                    return (
                      <li
                        key={i}
                        className={cn(
                          "flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px]",
                          tone === "destructive" && "border-destructive/30 bg-destructive/10",
                          tone === "warning" && "border-warning/30 bg-warning/10",
                          tone === "muted" && "border-border/40 bg-muted/30",
                        )}
                      >
                        <AlertCircle
                          className={cn(
                            "h-4 w-4 shrink-0 mt-0.5",
                            tone === "destructive" && "text-destructive",
                            tone === "warning" && "text-warning",
                            tone === "muted" && "text-muted-foreground",
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold">{s.code}</div>
                          <div className="text-muted-foreground">{s.message}</div>
                        </div>
                        <span
                          className={cn(
                            "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0",
                            tone === "destructive" && "bg-destructive/20 text-destructive",
                            tone === "warning" && "bg-warning/20 text-warning",
                            tone === "muted" && "bg-muted text-muted-foreground",
                          )}
                        >
                          {s.severity}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Recomendações */}
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                <Lightbulb className="h-3.5 w-3.5" /> Recomendações (
                {brain.recommendations?.length ?? 0})
              </div>
              {(!brain.recommendations || brain.recommendations.length === 0) ? (
                <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
                  Sem ações sugeridas no momento.
                </div>
              ) : (
                <ol className="space-y-1.5">
                  {brain.recommendations
                    .slice()
                    .sort((a, b) => a.priority - b.priority)
                    .map((r, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[12px]"
                      >
                        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold shrink-0">
                          {r.priority}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold">{r.action}</div>
                          <div className="text-muted-foreground">{r.reason}</div>
                        </div>
                      </li>
                    ))}
                </ol>
              )}
            </div>

            <div className="text-[10px] text-muted-foreground text-right">
              Atualizado{" "}
              {brain.last_calculated_at
                ? new Date(brain.last_calculated_at).toLocaleString("pt-BR")
                : "—"}
            </div>
          </div>
        )}

        <DialogFooter>
          {curator && (
            <Button variant="outline" asChild>
              <a href={`/curadores/${curator.id}`}>Abrir perfil completo</a>
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => curator && recalc.mutate(curator.id)}
            disabled={recalc.isPending || !curator}
          >
            <RefreshCw
              className={cn("h-4 w-4 mr-2", recalc.isPending && "animate-spin")}
            />
            Recalcular
          </Button>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
