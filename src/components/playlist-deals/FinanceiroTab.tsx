// FinanceiroTab — aba "Custo" do módulo Financeiro.
// Fase 8.1: consome o HOOK ÚNICO useFinancialOverview.
// Sem fórmulas proprietárias. Sem hero "Saldo virtual". KPIs sempre vindos das views.
import { useMemo, useState } from "react";
import { Wallet, Receipt, Trophy, Medal, Award, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  useFinancialOverview,
  type CuratorPurchase,
} from "@/hooks/useFinancialOverview";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Kpi } from "@/components/ui/kpi";
import type { CuratorDeal } from "@/lib/curatorDealsUtils";
import { BaselineConflictFinancialAlert } from "./BaselineConflictFinancialAlert";

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtCpp = (v: number | null | undefined) =>
  v == null ? "—" : `R$ ${Number(v).toFixed(4)}`;

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || "?";

const toDateInput = (iso: string) => new Date(iso).toISOString().slice(0, 10);

const parseBRNumber = (value: string) => Number(value.replace(/\./g, "").replace(",", ".")) || 0;

interface Props {
  // Mantido na assinatura por compatibilidade — não é mais consumido aqui.
  deals?: CuratorDeal[];
  // Mantido por compat (Financeiro.tsx). A aba não exibe mais hero.
  hideHero?: boolean;
}

export function FinanceiroTab(_props: Props) {
  const { byCurator, purchases, totals, loading, updatePurchase, deletePurchase } =
    useFinancialOverview();
  const [editingPurchase, setEditingPurchase] = useState<CuratorPurchase | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CuratorPurchase | null>(null);
  const [editPlays, setEditPlays] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editNote, setEditNote] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const openEdit = (purchase: CuratorPurchase) => {
    setEditingPurchase(purchase);
    setEditPlays(String(purchase.plays_purchased ?? 0));
    setEditAmount(String(Number(purchase.amount ?? 0)).replace(".", ","));
    setEditDate(toDateInput(purchase.purchased_at));
    setEditNote(purchase.note ?? "");
  };

  const handleSaveEdit = async () => {
    if (!editingPurchase) return;
    setSavingEdit(true);
    try {
      await updatePurchase(editingPurchase.id, {
        plays_purchased: parseInt(editPlays.replace(/\D/g, ""), 10) || 0,
        amount: parseBRNumber(editAmount),
        purchased_at: editDate
          ? new Date(`${editDate}T12:00:00`).toISOString()
          : editingPurchase.purchased_at,
        note: editNote.trim() || null,
      });
      toast.success("Compra atualizada");
      setEditingPurchase(null);
    } catch (e) {
      toast.error("Erro ao editar compra", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deletePurchase(deleteTarget.id);
      toast.success("Compra removida");
      setDeleteTarget(null);
    } catch (e) {
      toast.error("Erro ao remover compra", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDeleting(false);
    }
  };

  // Ranking por menor CPP (origem: v_curator_finance)
  const ranking = useMemo(() => {
    return [...byCurator]
      .filter((r) => r.plays_purchased > 0)
      .sort((a, b) => (a.cpp ?? Infinity) - (b.cpp ?? Infinity));
  }, [byCurator]);

  // Pódio por volume investido
  const topByVolume = useMemo(() => {
    return [...byCurator]
      .filter((r) => r.total_cost > 0)
      .sort((a, b) => b.total_cost - a.total_cost)
      .slice(0, 3);
  }, [byCurator]);

  // Compras agrupadas por dia para timeline
  const timeline = useMemo(() => {
    const groups: Record<string, CuratorPurchase[]> = {};
    for (const p of purchases.slice(0, 40)) {
      const d = new Date(p.purchased_at);
      const key = d.toISOString().slice(0, 10);
      (groups[key] ??= []).push(p);
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [purchases]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-32 rounded-2xl bg-card border border-border animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-72 rounded-2xl bg-card border border-border animate-pulse" />
          <div className="h-72 rounded-2xl bg-card border border-border animate-pulse" />
        </div>
      </div>
    );
  }

  const isEmpty = totals.totalPlays === 0;

  return (
    <>
      <div className="space-y-6">
        <BaselineConflictFinancialAlert />

        {/* ============= KPIs oficiais (origem: v_curator_global_finance) ============= */}
        {!isEmpty && (
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Kpi
              icon={Wallet}
              label="Total investido"
              value={fmtBRL(totals.custoCaixa)}
              tone="primary"
              hint={
                totals.custoNaoAlocado > 0
                  ? `${fmtBRL(totals.custoNaoAlocado)} sem deal vinculado`
                  : undefined
              }
            />
            <Kpi icon={Receipt} label="CPP médio" value={fmtCpp(totals.cppGlobal)} />
            <Kpi icon={Trophy} label="Curadores ativos" value={String(totals.curatorsCount)} />
          </section>
        )}

        {/* ============= PÓDIO ============= */}
        {topByVolume.length > 0 && (
          <section>
            <header className="mb-3 flex items-baseline justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Pódio do investimento</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Quem mais recebeu volume financeiro</p>
              </div>
            </header>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {topByVolume.map((r, idx) => {
                const share =
                  totals.custoCaixa > 0 ? (r.total_cost / totals.custoCaixa) * 100 : 0;
                const medalIcon = idx === 0 ? Trophy : idx === 1 ? Medal : Award;
                const medalColor =
                  idx === 0
                    ? "text-amber-400 bg-amber-400/10"
                    : idx === 1
                      ? "text-zinc-300 bg-zinc-300/10"
                      : "text-amber-700 bg-amber-700/10";
                const Icon = medalIcon;
                return (
                  <div
                    key={r.curator_id}
                    className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className={cn("h-9 w-9 rounded-full flex items-center justify-center", medalColor)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        #{idx + 1}
                      </span>
                    </div>
                    <div>
                      <div className="text-base font-semibold text-foreground truncate">{r.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                        {formatNumber(r.plays_purchased)} plays · {r.purchase_count} compra
                        {r.purchase_count === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex items-end justify-between pt-2 border-t border-border">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Investido</div>
                        <div className="text-lg font-bold text-foreground tabular-nums">{fmtBRL(r.total_cost)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">CPP</div>
                        <div className="text-sm font-semibold tabular-nums text-primary">{fmtCpp(r.cpp)}</div>
                      </div>
                    </div>
                    <div className="h-1 rounded-full bg-elevated/60 overflow-hidden">
                      <div
                        className="h-full bg-primary/70 rounded-full"
                        style={{ width: `${Math.min(100, share)}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {share.toFixed(1)}% do total investido
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ============= RANKING + TIMELINE ============= */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">
          {/* Ranking */}
          <section className="rounded-2xl bg-card border border-border overflow-hidden">
            <header className="px-4 sm:px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Ranking de eficiência</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Menor CPP primeiro · barra mostra share do investimento
              </p>
            </header>
            {ranking.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                Sem compras registradas
              </div>
            ) : (
              <ul className="divide-y divide-border max-h-[460px] overflow-auto">
                {ranking.map((r, i) => {
                  const share =
                    totals.custoCaixa > 0 ? (r.total_cost / totals.custoCaixa) * 100 : 0;
                  const isCheap =
                    totals.cppGlobal != null && r.cpp != null && r.cpp < totals.cppGlobal;
                  const isExpensive =
                    totals.cppGlobal != null && r.cpp != null && r.cpp > totals.cppGlobal * 1.5;
                  return (
                    <li
                      key={r.curator_id}
                      className="px-4 sm:px-5 py-3 hover:bg-elevated/40 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 sm:gap-3">
                        <span className="w-4 text-xs text-muted-foreground tabular-nums text-right shrink-0">
                          {i + 1}
                        </span>
                        <div className="h-8 w-8 rounded-full bg-elevated flex items-center justify-center text-[11px] font-semibold text-foreground shrink-0">
                          {initials(r.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground truncate text-[15px] sm:text-sm">
                              {r.name}
                            </span>
                            <span
                              className={cn(
                                "text-sm font-semibold tabular-nums shrink-0",
                                isCheap && "text-primary",
                                isExpensive && "text-amber-500",
                                !isCheap && !isExpensive && "text-foreground",
                              )}
                            >
                              {fmtCpp(r.cpp)}
                            </span>
                          </div>
                          <div className="mt-1.5 h-1 rounded-full bg-elevated/60 overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                isCheap
                                  ? "bg-primary/70"
                                  : isExpensive
                                    ? "bg-amber-500/60"
                                    : "bg-muted-foreground/40",
                              )}
                              style={{ width: `${Math.min(100, share)}%` }}
                            />
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
                            <span>{fmtBRL(r.total_cost)}</span>
                            <span>{formatNumber(r.plays_purchased)} plays</span>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Timeline */}
          <section className="rounded-2xl bg-card border border-border overflow-hidden">
            <header className="px-4 sm:px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Últimas compras</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Histórico de compras do ledger</p>
            </header>
            {timeline.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                Sem compras registradas
              </div>
            ) : (
              <div className="max-h-[460px] overflow-auto px-4 sm:px-5 py-4">
                {timeline.map(([day, items]) => {
                  const dayTotal = items.reduce((acc, p) => acc + Number(p.amount ?? 0), 0);
                  const dayPlays = items.reduce(
                    (acc, p) => acc + Number(p.plays_purchased ?? 0),
                    0,
                  );
                  const dateLabel = new Date(day + "T12:00:00").toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "short",
                  });
                  return (
                    <div key={day} className="mb-5 last:mb-0">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 mb-2">
                        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                          {dateLabel}
                        </span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {fmtBRL(dayTotal)} · {formatNumber(dayPlays)} plays
                        </span>
                      </div>
                      <ul className="space-y-2 pl-3 border-l border-border">
                        {items.map((p) => {
                          const curator = byCurator.find((c) => c.curator_id === p.curator_id);
                          return (
                            <li key={p.id} className="relative pl-3">
                              <span className="absolute -left-[7px] top-2 h-2 w-2 rounded-full bg-primary/60 ring-2 ring-card" />
                              <div className="flex items-center justify-between gap-3 text-sm">
                                <span className="font-medium text-foreground truncate">
                                  {curator?.name ?? "—"}
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="text-xs text-muted-foreground tabular-nums">
                                    {fmtBRL(p.amount)}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                    title="Editar compra"
                                    onClick={() => openEdit(p)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    title="Remover compra"
                                    onClick={() => setDeleteTarget(p)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                              <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                                {formatNumber(p.plays_purchased)} plays · {fmtCpp(p.cpp)}
                                {p.note && <span className="ml-2 opacity-70">· {p.note}</span>}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      <Dialog
        open={!!editingPurchase}
        onOpenChange={(open) => !open && setEditingPurchase(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar compra</DialogTitle>
            <DialogDescription>
              Altere o valor, plays, data ou observação deste lançamento.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-purchase-amount">Valor</Label>
              <Input
                id="edit-purchase-amount"
                inputMode="decimal"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                placeholder="62000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-purchase-plays">Plays comprados</Label>
              <Input
                id="edit-purchase-plays"
                inputMode="numeric"
                value={editPlays}
                onChange={(e) => setEditPlays(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-purchase-date">Data</Label>
              <Input
                id="edit-purchase-date"
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-purchase-note">Observação</Label>
              <Input
                id="edit-purchase-note"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="Opcional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPurchase(null)} disabled={savingEdit}>
              Cancelar
            </Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover compra?</AlertDialogTitle>
            <AlertDialogDescription>
              Este lançamento será removido do histórico e o saldo do curador será recalculado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
