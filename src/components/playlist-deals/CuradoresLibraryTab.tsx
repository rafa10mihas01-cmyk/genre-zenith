import { useMemo, useState } from "react";
import {
  Search,
  Users,
  ListMusic,
  ExternalLink,
  Activity,
  CheckCircle2,
  DollarSign,
  Clock,
  Archive,
  Music2,
  TrendingUp,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CuratorLibrarySheet } from "@/components/curators/CuratorLibrarySheet";
import { CuratorEditDialog } from "@/components/curators/CuratorEditDialog";
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
  onArchiveCurator?: (curatorId: string, archive?: boolean) => Promise<void>;
}

export function CuradoresLibraryTab({
  curators,
  balances,
  deals,
  loading,
  onUpdateCurator,
  onArchiveCurator,
}: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Curator | null>(null);
  const [editing, setEditing] = useState<Curator | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return curators
      .filter((c) => !c.archived_at)
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

        // Última atividade = deal mais recente (started_at ou closed_at)
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
          purchased > 0
            ? Math.min(100, Math.round((consumed / purchased) * 100))
            : 0;
        const cpp = consumed > 0 && totalCost > 0 ? totalCost / consumed : null;

        return {
          curator: c,
          balance,
          activeDeals,
          closedDeals,
          totalDeals: curatorDeals.length,
          lastTs,
          totalCost,
          purchased,
          consumed,
          remaining,
          overbooked,
          consumedPct,
          cpp,
        };
      })
      .sort((a, b) => {
        // ativos primeiro, depois por última atividade
        if (a.activeDeals !== b.activeDeals) return b.activeDeals - a.activeDeals;
        return b.lastTs - a.lastTs;
      });
  }, [curators, balances, deals, query]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar curador…"
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="nx-card h-72 animate-pulse" />
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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

            const statusLabel =
              activeDeals > 0
                ? `${activeDeals} ativo${activeDeals > 1 ? "s" : ""}`
                : totalDeals > 0
                ? "Sem deals ativos"
                : "Sem deals";

            const initials = curator.name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((s) => s[0]?.toUpperCase())
              .join("");

            return (
              <Card
                key={curator.id}
                className={cn(
                  "overflow-hidden border-border/60 transition-all duration-200 cursor-pointer",
                  "hover:border-foreground/25 hover:-translate-y-[1px]",
                  "hover:shadow-[0_18px_40px_-18px_rgba(0,0,0,0.85),0_0_32px_-8px_hsl(141_76%_48%_/_0.18)]",
                  "bg-[linear-gradient(180deg,rgba(255,255,255,0.025)_0%,transparent_40%),hsl(var(--card))]",
                )}
                onClick={() => setSelected(curator)}
              >
                <CardContent className="p-5 pt-5 md:pt-5 flex flex-col gap-4">
                  {/* Header: avatar + nome + status */}
                  <div className="flex items-start gap-3 min-w-0 pb-1">
                    <div className="h-11 w-11 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-[14px] font-bold text-primary shrink-0">
                      {initials || <Users className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1">
                        Curador
                      </div>
                      <div className="text-[20px] font-semibold tracking-tight text-foreground truncate leading-tight">
                        {curator.name}
                      </div>
                      {curator.contact && (
                        <div className="text-[12px] text-muted-foreground truncate mt-0.5">
                          {curator.contact}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] px-2.5 py-0.5 h-6 font-semibold gap-1 rounded-full",
                          activeDeals > 0 && "bg-primary/15 text-primary",
                        )}
                      >
                        {activeDeals > 0 && <Activity className="h-2.5 w-2.5" />}
                        {statusLabel}
                      </Badge>
                      {(onUpdateCurator || onArchiveCurator) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Mais ações"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-44"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {onUpdateCurator && (
                              <DropdownMenuItem
                                className="gap-2"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditing(curator);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                                Editar
                              </DropdownMenuItem>
                            )}
                            {onArchiveCurator && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="gap-2 text-destructive focus:text-destructive"
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
                                  <Archive className="h-4 w-4" />
                                  Arquivar
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>

                  {/* Alert overbooking */}
                  {overbooked && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 flex items-center gap-1.5">
                      <TrendingUp className="h-3.5 w-3.5 text-destructive shrink-0" />
                      <span className="text-[11px] text-destructive font-medium">
                        Saldo estourado — consumo acima do comprado
                      </span>
                    </div>
                  )}

                  {/* KPIs — números grandes (espelha CuratorDealCard) */}
                  <div className="grid grid-cols-2 divide-x divide-border/50 rounded-xl bg-[hsl(var(--elevated))] border border-border/40">
                    <div className="px-4 py-3">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1.5">
                        Plays comprados
                      </div>
                      <div className="text-[24px] font-bold tabular-nums text-foreground leading-none tracking-tight">
                        {formatPlays(purchased)}
                      </div>
                      {totalCost > 0 && (
                        <div className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
                          {formatBRL(totalCost)} total
                        </div>
                      )}
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1.5">
                        Restante
                      </div>
                      <div className="text-[24px] font-bold tabular-nums leading-none tracking-tight">
                        <span className={cn(overbooked ? "text-destructive" : "text-primary")}>
                          {overbooked ? "Estourado" : formatPlays(remaining)}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
                        {formatPlays(consumed)} consumido
                      </div>
                    </div>
                  </div>

                  {/* Progress bar — % consumido */}
                  {purchased > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                          Saldo consumido
                        </span>
                        <span className="tabular-nums text-[14px] font-bold text-foreground">
                          {consumedPct}%
                        </span>
                      </div>
                      <Progress value={consumedPct} className="h-2.5 rounded-full" />
                    </div>
                  )}

                  {/* Chips: deals + custo/play + última atividade */}
                  <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground border-t border-border/40 pt-2.5">
                    {activeDeals > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Activity className="h-3 w-3 text-primary" />
                        <span className="tabular-nums font-semibold text-foreground">
                          {activeDeals}
                        </span>{" "}
                        ativo{activeDeals > 1 ? "s" : ""}
                      </span>
                    )}
                    {closedDeals > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        <span className="tabular-nums font-semibold text-foreground">
                          {closedDeals}
                        </span>{" "}
                        concluído{closedDeals > 1 ? "s" : ""}
                      </span>
                    )}
                    {totalDeals === 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Music2 className="h-3 w-3" />
                        Sem deals ainda
                      </span>
                    )}
                    {cpp !== null && (
                      <span className="inline-flex items-center gap-1">
                        <DollarSign className="h-3 w-3" />
                        <span className="text-foreground font-medium">
                          {formatCPP(cpp)}
                        </span>
                        /play
                      </span>
                    )}
                    {lastTs > 0 && (
                      <span className="inline-flex items-center gap-1 ml-auto">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(lastTs), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </span>
                    )}
                  </div>

                  {/* Ações */}
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <Button
                      size="sm"
                      className="flex-1 h-9 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-[13px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(curator);
                      }}
                    >
                      <ListMusic className="h-3.5 w-3.5" />
                      Ver biblioteca
                    </Button>
                    {curator.spotify_owner_url && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 gap-1.5 text-[12px]"
                        asChild
                      >
                        <a
                          href={curator.spotify_owner_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Spotify
                        </a>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CuratorLibrarySheet
        curator={selected}
        deals={deals.filter((d) => d.curator_id === selected?.id)}
        balance={balances.find((b) => b.curator_id === selected?.id) ?? null}
        onClose={() => setSelected(null)}
      />

      {onUpdateCurator && (
        <CuratorEditDialog
          curator={editing}
          open={editing !== null}
          onOpenChange={(v) => !v && setEditing(null)}
          onSave={onUpdateCurator}
        />
      )}
    </div>
  );
}
