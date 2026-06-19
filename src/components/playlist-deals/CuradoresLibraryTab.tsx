import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Users,
  ListMusic,
  CheckCircle2,
  DollarSign,
  Clock,
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  Trash2,
  Pause,
  Play,
  Plus,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusDot, type StatusVariant } from "@/components/ui/status-dot";
import { MetricCell } from "@/components/ui/metric-cell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { CuratorLibrarySheet } from "@/components/curators/CuratorLibrarySheet";
import { CuratorEditDialog } from "@/components/curators/CuratorEditDialog";
import { NewCuratorDialog } from "@/components/curators/NewCuratorDialog";
import { cn } from "@/lib/utils";
import type { Curator, CuratorBalance, NewCuratorInput } from "@/hooks/useCuratorDeals";
import type { CuratorDeal } from "@/lib/curatorDealsUtils";

function formatPlays(n: number | null | undefined): string {
  if (!n || !Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return Math.round(n).toLocaleString("pt-BR");
}

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(v);
}

function formatCPP(v: number) {
  const opts =
    v < 0.01
      ? { minimumFractionDigits: 4, maximumFractionDigits: 4 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    ...opts,
  }).format(v);
}

interface Props {
  curators: Curator[];
  balances: CuratorBalance[];
  deals: CuratorDeal[];
  loading: boolean;
  onUpdateCurator?: (curatorId: string, input: Partial<NewCuratorInput>) => Promise<void>;
  onAddCurator?: (input: NewCuratorInput) => Promise<unknown>;
  onAddPurchase?: (curatorId: string, input: { plays_purchased: number; amount: number; note?: string | null }) => Promise<void>;
  onArchiveCurator?: (curatorId: string, archive?: boolean) => Promise<void>;
  onDeleteCurator?: (curatorId: string) => Promise<void>;
  onPauseCurator?: (curatorId: string, pause?: boolean) => Promise<void>;
  /** Quando o botão "+ Novo curador" é renderizado pelo pai (ex.: PageHeader), oculta o da toolbar interna. */
  hideAddButton?: boolean;
  /** Controle externo do dialog de criação (opcional). */
  creatingOpen?: boolean;
  onCreatingOpenChange?: (open: boolean) => void;
}

export function CuradoresLibraryTab({
  curators,
  balances,
  deals,
  loading,
  onUpdateCurator,
  onAddCurator,
  onAddPurchase,
  onArchiveCurator,
  onDeleteCurator,
  onPauseCurator,
  hideAddButton,
  creatingOpen,
  onCreatingOpenChange,
}: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Curator | null>(null);
  const [internalCreating, setInternalCreating] = useState(false);
  const creating = creatingOpen ?? internalCreating;
  const setCreating = (open: boolean) => {
    if (onCreatingOpenChange) onCreatingOpenChange(open);
    else setInternalCreating(open);
  };
  const [showArchived, setShowArchived] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ curator: Curator; hasDeals: boolean } | null>(null);

  // Filtros
  const [statusFilter, setStatusFilter] = useState<"all" | "ativo" | "pausado" | "sem_deals" | "estourado">("all");
  const [cppFilter, setCppFilter] = useState<"all" | "lt001" | "001-005" | "gt005">("all");
  const [activityFilter, setActivityFilter] = useState<"all" | "7d" | "30d" | "90d">("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;


  const archivedCount = curators.filter((c) => !!c.archived_at).length;

  const allRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    const activityMs =
      activityFilter === "7d" ? 7 * 86400_000 :
      activityFilter === "30d" ? 30 * 86400_000 :
      activityFilter === "90d" ? 90 * 86400_000 : null;
    return curators
      .filter((c) => (showArchived ? !!c.archived_at : !c.archived_at))
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          (c.contact ?? "").toLowerCase().includes(q),
      )
      .map((c) => {
        const balance = balances.find((b) => b.curator_id === c.id);
        const curatorDeals = deals.filter((d) => d.curator_id === c.id);
        const activeDeals = curatorDeals.filter((d) => !d.closed_at).length;
        const closedDeals = curatorDeals.filter((d) => !!d.closed_at).length;

        const lastTs = curatorDeals.reduce<number>((acc, d) => {
          const t = new Date(d.closed_at ?? d.started_at).getTime();
          return Number.isFinite(t) && t > acc ? t : acc;
        }, 0);

        const totalCost = Number(balance?.total_cost ?? c.total_cost ?? 0) || 0;
        const purchased = Number(balance?.purchased_plays ?? c.purchased_plays ?? 0) || 0;
        const consumed = Number(balance?.consumed_plays ?? 0) || 0;
        const remaining = Number(balance?.remaining_plays ?? 0) || 0;
        const overbooked = Number(balance?.overbooked_plays ?? 0) > 0;
        const consumedPct =
          purchased > 0 ? Math.min(100, Math.round((consumed / purchased) * 100)) : 0;
        const cpp = consumed > 0 && totalCost > 0 ? totalCost / consumed : null;

        return {
          curator: c, balance, activeDeals, closedDeals,
          totalDeals: curatorDeals.length,
          lastTs, totalCost, purchased, consumed, remaining, overbooked, consumedPct, cpp,
        };
      })
      .filter((r) => {
        if (statusFilter === "ativo" && !(r.activeDeals > 0 && !r.curator.paused_at && !r.overbooked)) return false;
        if (statusFilter === "pausado" && !r.curator.paused_at) return false;
        if (statusFilter === "estourado" && !r.overbooked) return false;
        if (statusFilter === "sem_deals" && r.totalDeals > 0) return false;
        if (cppFilter !== "all") {
          if (r.cpp === null) return false;
          if (cppFilter === "lt001" && !(r.cpp < 0.01)) return false;
          if (cppFilter === "001-005" && !(r.cpp >= 0.01 && r.cpp <= 0.05)) return false;
          if (cppFilter === "gt005" && !(r.cpp > 0.05)) return false;
        }
        if (activityMs !== null) {
          if (r.lastTs === 0 || now - r.lastTs > activityMs) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.activeDeals !== b.activeDeals) return b.activeDeals - a.activeDeals;
        return b.lastTs - a.lastTs;
      });
  }, [curators, balances, deals, query, showArchived, statusFilter, cppFilter, activityFilter]);

  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const rows = useMemo(
    () => allRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [allRows, safePage],
  );

  // reset page quando filtros mudam
  const filterKey = `${query}|${showArchived}|${statusFilter}|${cppFilter}|${activityFilter}`;
  useEffect(() => { setPage(0); }, [filterKey]);

  const hasFilters = statusFilter !== "all" || cppFilter !== "all" || activityFilter !== "all";

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2 flex-nowrap">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={showArchived ? "Buscar…" : "Buscar curador…"}
            className="pl-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="h-9 w-[130px] shrink-0"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="ativo">Ativos</SelectItem>
            <SelectItem value="pausado">Pausados</SelectItem>
            <SelectItem value="estourado">Saldo estourado</SelectItem>
            <SelectItem value="sem_deals">Sem deals</SelectItem>
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className={cn("h-9 w-9 shrink-0 relative", (cppFilter !== "all" || activityFilter !== "all") && "border-primary text-primary")}
              aria-label="Mais filtros"
              title="Mais filtros"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {(cppFilter !== "all" || activityFilter !== "all") && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 space-y-3">
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">CPP</label>
              <Select value={cppFilter} onValueChange={(v) => setCppFilter(v as typeof cppFilter)}>
                <SelectTrigger className="h-9 w-full"><SelectValue placeholder="CPP" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Qualquer CPP</SelectItem>
                  <SelectItem value="lt001">&lt; R$ 0,01</SelectItem>
                  <SelectItem value="001-005">R$ 0,01–0,05</SelectItem>
                  <SelectItem value="gt005">&gt; R$ 0,05</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Atividade</label>
              <Select value={activityFilter} onValueChange={(v) => setActivityFilter(v as typeof activityFilter)}>
                <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Atividade" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Qualquer período</SelectItem>
                  <SelectItem value="7d">Últimos 7 dias</SelectItem>
                  <SelectItem value="30d">Últimos 30 dias</SelectItem>
                  <SelectItem value="90d">Últimos 90 dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </PopoverContent>
        </Popover>

        {onAddCurator && (
          <Button
            size="sm"
            className="h-9 gap-1.5 shrink-0"
            onClick={() => setCreating(true)}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Novo curador</span>
          </Button>
        )}
      </div>

      {(hasFilters || archivedCount > 0 || showArchived) && (
        <div className="flex items-center gap-2 flex-wrap">
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground"
              onClick={() => { setStatusFilter("all"); setCppFilter("all"); setActivityFilter("all"); }}
            >
              Limpar filtros
            </Button>
          )}
          {(archivedCount > 0 || showArchived) && (
            <Button
              variant={showArchived ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 ml-auto"
              onClick={() => setShowArchived((v) => !v)}
            >
              <Archive className="h-3.5 w-3.5" />
              {showArchived ? "Ver ativos" : `Arquivados (${archivedCount})`}
            </Button>
          )}
        </div>
      )}

      {(allRows.length === 0 || totalPages > 1) && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{allRows.length === 0 ? "Nenhum resultado" : ""}</span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                aria-label="Página anterior"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="px-2 tabular-nums">{safePage + 1} / {totalPages}</span>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                aria-label="Próxima página"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}


      {loading && curators.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="h-[220px] rounded-2xl border border-border/50 bg-card animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="mx-auto size-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            {query ? "Nenhum curador encontrado." : "Nenhum curador cadastrado ainda."}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {rows.map((row) => {
            const {
              curator,
              activeDeals,
              closedDeals,
              totalDeals,
              lastTs,
              totalCost,
              purchased,
              consumed,
              remaining,
              overbooked,
              consumedPct,
              cpp,
            } = row;

            const initials = curator.name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((s) => s[0]?.toUpperCase())
              .join("");

            const status: { variant: StatusVariant; label: string } = curator.paused_at
              ? { variant: "warning", label: "Pausado" }
              : overbooked
              ? { variant: "danger", label: "Saldo estourado" }
              : activeDeals > 0
              ? { variant: "success", label: `${activeDeals} ativo${activeDeals > 1 ? "s" : ""}` }
              : totalDeals > 0
              ? { variant: "neutral", label: "Sem deals ativos" }
              : { variant: "neutral", label: "Sem deals" };

            return (
              <div
                key={curator.id}
                onClick={() => navigate(`/curadores/${curator.id}`)}
                style={{ contentVisibility: "auto", containIntrinsicSize: "320px 220px" }}
                className={cn(
                  "group relative rounded-2xl border border-border/50 bg-card transition-colors cursor-pointer",
                  "border-l-2 border-l-domain-curators/60",
                  "hover:border-foreground/20 hover:border-l-domain-curators hover:bg-[hsl(var(--elevated))]",
                )}
              >
                {/* Linha 1 — identidade */}
                <div className="flex items-center gap-2 px-3 pt-3 pb-2 min-w-0">
                  <div className="h-8 w-8 rounded-md bg-domain-curators/15 border border-domain-curators/25 flex items-center justify-center text-[11px] font-bold text-domain-curators shrink-0">
                    {initials || <Users className="h-3.5 w-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold text-foreground truncate leading-tight">
                      {curator.name}
                    </div>
                    <div className="text-[10.5px] text-muted-foreground truncate mt-0.5">
                      <span>Curador</span>
                      {curator.contact && (
                        <>
                          <span className="mx-1 opacity-50">·</span>
                          <span>{curator.contact}</span>
                        </>
                      )}
                      {totalDeals > 0 && (
                        <>
                          <span className="mx-1 opacity-50">·</span>
                          <span>{totalDeals} deal{totalDeals > 1 ? "s" : ""}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <StatusDot variant={status.variant} label={status.label} className="shrink-0" />

                  {(onUpdateCurator || onArchiveCurator || onDeleteCurator || onPauseCurator) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Mais ações"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-44 rounded-xl p-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenuItem
                          className="gap-2 rounded-lg"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/curadores/${curator.id}`);
                          }}
                        >
                          <ListMusic className="h-4 w-4" /> Ver biblioteca
                        </DropdownMenuItem>
                        {onUpdateCurator && onAddPurchase && (
                          <DropdownMenuItem
                            className="gap-2 rounded-lg"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditing(curator);
                            }}
                          >
                            <Plus className="h-4 w-4" /> Registrar compra
                          </DropdownMenuItem>
                        )}
                        {onUpdateCurator && (
                          <DropdownMenuItem
                            className="gap-2 rounded-lg"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditing(curator);
                            }}
                          >
                            <Pencil className="h-4 w-4" /> Editar
                          </DropdownMenuItem>
                        )}
                        {(onArchiveCurator || onDeleteCurator || onPauseCurator) && (
                          <DropdownMenuSeparator />
                        )}
                        {onPauseCurator && !curator.archived_at && (
                          <DropdownMenuItem
                            className="gap-2 rounded-lg"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const pause = !curator.paused_at;
                              try {
                                await onPauseCurator(curator.id, pause);
                                toast.success(pause ? "Curador pausado — coleta congelada" : "Curador retomado");
                              } catch {
                                toast.error("Erro ao alterar pausa");
                              }
                            }}
                          >
                            {curator.paused_at ? (
                              <><Play className="h-4 w-4" /> Retomar</>
                            ) : (
                              <><Pause className="h-4 w-4" /> Pausar</>
                            )}
                          </DropdownMenuItem>
                        )}
                        {onArchiveCurator && !curator.archived_at && (
                          <DropdownMenuItem
                            className="gap-2 rounded-lg"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (activeDeals > 0) {
                                toast.error("Curador tem deals ativos — encerre antes de arquivar");
                                return;
                              }
                              if (!confirm(`Arquivar ${curator.name}? Ele sai da biblioteca mas o histórico fica.`)) return;
                              try {
                                await onArchiveCurator(curator.id, true);
                                toast.success("Curador arquivado");
                              } catch {
                                toast.error("Erro ao arquivar");
                              }
                            }}
                          >
                            <Archive className="h-4 w-4" /> Arquivar
                          </DropdownMenuItem>
                        )}
                        {onArchiveCurator && curator.archived_at && (
                          <DropdownMenuItem
                            className="gap-2 rounded-lg"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await onArchiveCurator(curator.id, false);
                                toast.success("Curador restaurado");
                              } catch {
                                toast.error("Erro ao restaurar");
                              }
                            }}
                          >
                            <ArchiveRestore className="h-4 w-4" /> Restaurar
                          </DropdownMenuItem>
                        )}
                        {onDeleteCurator && (
                          <DropdownMenuItem
                            className="gap-2 rounded-lg text-destructive focus:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDelete({ curator, hasDeals: totalDeals > 0 });
                            }}
                          >
                            <Trash2 className="h-4 w-4" /> Excluir
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                <div className="mx-3 border-t border-border/40" />

                {/* Linha 2 — métricas (empilhadas para o grid 4-col) */}
                <div className="px-3 py-2.5 space-y-2 min-w-0">
                  <div className="grid grid-cols-2 gap-2">
                    <MetricCell
                      label="Comprados"
                      value={formatPlays(purchased)}
                      size="sm"
                    />
                    <MetricCell
                      label="Restante"
                      value={overbooked ? "Estourado" : formatPlays(remaining)}
                      size="sm"
                      className={cn(overbooked && "[&_*]:text-destructive")}
                    />
                  </div>
                  {purchased > 0 && (
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-center justify-between text-[9.5px] text-muted-foreground">
                        <span className="uppercase tracking-[0.12em] font-medium">Consumido</span>
                        <span className="tabular-nums font-semibold text-foreground">{consumedPct}%</span>
                      </div>
                      <Progress value={consumedPct} className="h-1 rounded-full" />
                      <div className="text-[9.5px] text-muted-foreground tabular-nums">
                        {formatPlays(consumed)} / {formatPlays(purchased)}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground pt-1 border-t border-border/30">
                    {cpp !== null && (
                      <span className="inline-flex items-center gap-0.5 tabular-nums">
                        <DollarSign className="h-2.5 w-2.5" />
                        <span className="text-foreground font-medium">{formatCPP(cpp)}</span>/play
                      </span>
                    )}
                    {totalCost > 0 && (
                      <span className="tabular-nums">{formatBRL(totalCost)}</span>
                    )}
                    {lastTs > 0 && (
                      <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDistanceToNow(new Date(lastTs), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </span>
                    )}
                    {closedDeals > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        {closedDeals}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detalhe do curador vive em /curadores/:id — sem drawer aqui. */}

      {onUpdateCurator && (
        <CuratorEditDialog
          curator={editing}
          open={editing !== null}
          onOpenChange={(v) => !v && setEditing(null)}
          onSave={onUpdateCurator}
          onAddPurchase={onAddPurchase}
        />
      )}

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir curador?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.hasDeals
                ? `${confirmDelete.curator.name} possui deals vinculados. Não é possível excluir — arquive em vez disso.`
                : `${confirmDelete?.curator.name} será removido permanentemente, junto com o saldo financeiro. Esta ação não pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {!confirmDelete?.hasDeals && (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async () => {
                  if (!confirmDelete || !onDeleteCurator) return;
                  try {
                    await onDeleteCurator(confirmDelete.curator.id);
                    toast.success("Curador excluído");
                    setConfirmDelete(null);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Erro ao excluir");
                  }
                }}
              >
                Excluir
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {onAddCurator && (
        <NewCuratorDialog
          open={creating}
          onOpenChange={setCreating}
          onCreate={onAddCurator}
        />
      )}
    </div>
  );
}
