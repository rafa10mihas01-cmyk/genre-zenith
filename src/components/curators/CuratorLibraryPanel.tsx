// CuratorLibraryPanel — corpo reutilizável da biblioteca + saldo do curador.
// Renderiza KPIs, saldo e catálogo. Sem Sheet/Dialog wrapper — usado tanto pelo
// CuratorLibrarySheet (drawer legado) quanto pela página dedicada /curadores/:id.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Plus,
  ExternalLink,
  ListMusic,
  Trash2,
  Loader2,
  Music,
  AlertTriangle,
  TrendingUp,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { useCuratorLibrary, type PerformanceClass } from "@/hooks/useCuratorLibrary";
import type { Curator, CuratorBalance } from "@/hooks/useCuratorDeals";
import type { CuratorDeal } from "@/lib/curatorDealsUtils";
import { useFormDraft } from "@/hooks/useFormDraft";
import { DraftBanner, DraftIndicator } from "@/components/forms/DraftBanner";

const PERF_LABEL: Record<PerformanceClass, string> = {
  excelente: "Excelente",
  boa: "Boa",
  media: "Média",
  fraca: "Fraca",
  suspeita: "Suspeita",
  novo: "Novo",
  sem_historico: "Sem histórico",
};

const PERF_CLASS: Record<PerformanceClass, string> = {
  excelente: "bg-success/15 text-success border-0",
  boa: "bg-primary/15 text-primary border-0",
  media: "bg-muted/40 text-muted-foreground border border-border",
  fraca: "bg-warning/15 text-warning border-0",
  suspeita: "bg-destructive/15 text-destructive border-0",
  novo: "bg-muted/40 text-muted-foreground border border-border",
  sem_historico: "bg-muted/30 text-muted-foreground/70 border border-border",
};

function formatPlays(n: number | null | undefined): string {
  if (!n || !Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return Math.round(n).toLocaleString("pt-BR");
}

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(v);
}
function formatCPP(v: number) {
  const opts = v < 0.01
    ? { minimumFractionDigits: 4, maximumFractionDigits: 4 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", ...opts }).format(v);
}

interface Props {
  curator: Curator;
  deals: CuratorDeal[];
  balance?: CuratorBalance | null;
  onAddPurchase?: (curatorId: string, input: { plays_purchased: number; amount: number; note?: string | null }) => Promise<void>;
  /** Quando true, remove o padding lateral interno (página dedicada já tem). */
  flush?: boolean;
}

export function CuratorLibraryPanel({ curator, deals, balance, onAddPurchase, flush = false }: Props) {
  const { items, stats, performance, genresByLibrary, loading, addManual, remove } = useCuratorLibrary(curator.id);
  const [genreFilter, setGenreFilter] = useState<string | null>(null);

  // Universo de gêneros já trabalhados nesse curador (deriva de clients.primary_genre).
  const availableGenres = (() => {
    const set = new Set<string>();
    for (const s of genresByLibrary.values()) for (const g of s) set.add(g);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  })();


  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [followers, setFollowers] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [buyPlays, setBuyPlays] = useState("");
  const [buyAmount, setBuyAmount] = useState("");
  const [buyNote, setBuyNote] = useState("");
  const [buying, setBuying] = useState(false);

  type PurchaseRow = {
    id: string;
    plays_purchased: number;
    amount: number;
    note: string | null;
    purchased_at: string;
  };
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [purchaseToDelete, setPurchaseToDelete] = useState<PurchaseRow | null>(null);
  const [deletingPurchase, setDeletingPurchase] = useState(false);

  const loadPurchases = async () => {
    setPurchasesLoading(true);
    const { data, error } = await supabase
      .from("curator_purchases")
      .select("id, plays_purchased, amount, note, purchased_at")
      .eq("curator_id", curator.id)
      .order("purchased_at", { ascending: false })
      .limit(20);
    if (!error && data) setPurchases(data as PurchaseRow[]);
    setPurchasesLoading(false);
  };

  useEffect(() => {
    loadPurchases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curator.id]);

  const handleBuy = async () => {
    if (!onAddPurchase) return;
    const plays = parseInt(buyPlays.replace(/\D/g, ""), 10) || 0;
    const amount = Number(buyAmount.replace(",", ".")) || 0;
    if (plays <= 0 && amount <= 0) {
      toast.error("Informe plays e/ou valor");
      return;
    }
    setBuying(true);
    try {
      await onAddPurchase(curator.id, { plays_purchased: plays, amount, note: buyNote });
      toast.success("Crédito adicionado");
      setBuyPlays(""); setBuyAmount(""); setBuyNote("");
      setBuyOpen(false);
      loadPurchases();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Erro ao adicionar crédito", { description: msg });
    } finally {
      setBuying(false);
    }
  };

  const draftKey = `curator-library-add:${curator.id}`;
  const isDraftEmpty = !name.trim() && !url.trim() && !followers.trim();
  const draft = useFormDraft(
    draftKey,
    { enabled: addOpen && !saving, isEmpty: isDraftEmpty },
    { name, url, followers },
  );

  const handleRestoreDraft = () => {
    const d = draft.restoreDraft();
    if (!d) return;
    setName(d.name);
    setUrl(d.url);
    setFollowers(d.followers);
  };

  const handleAdd = async () => {
    if (!name.trim() || !url.trim()) {
      toast.error("Preencha nome e link da playlist");
      return;
    }
    setSaving(true);
    try {
      await addManual({
        curator_id: curator.id,
        playlist_name: name.trim(),
        spotify_url: url.trim(),
        followers: followers ? parseInt(followers.replace(/\D/g, ""), 10) : null,
      });
      toast.success("Playlist adicionada à biblioteca");
      setName(""); setUrl(""); setFollowers("");
      draft.clearDraft();
      setAddOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Erro ao adicionar", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await remove(confirmDelete);
      toast.success("Playlist removida");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Erro ao remover", { description: msg });
    } finally {
      setConfirmDelete(null);
    }
  };

  const filteredItems = items.filter((p) => !genreFilter || genresByLibrary.get(p.id)?.has(genreFilter));

  return (
    <>
      {/* Saldo — card próprio, mesmo ritmo das seções do Cliente */}
      {(() => {
        const purchased = Number(balance?.purchased_plays ?? curator.purchased_plays ?? 0) || 0;
        const consumed = Number(balance?.consumed_plays ?? 0) || 0;
        const remaining = Number(balance?.remaining_plays ?? purchased) || 0;
        const overbooked = Number(balance?.overbooked_plays ?? 0) > 0;
        const totalCost = Number(balance?.total_cost ?? curator.total_cost ?? 0) || 0;
        const consumedPct = purchased > 0 ? Math.min(100, Math.round((consumed / purchased) * 100)) : 0;
        const cpp = consumed > 0 && totalCost > 0 ? totalCost / consumed : null;
        if (purchased === 0 && totalCost === 0 && !onAddPurchase) return null;
        return (
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Saldo</div>
              <div className="flex items-center gap-3">
                {cpp !== null && (
                  <span className="text-[11px] text-muted-foreground">
                    Custo/play <span className="text-foreground font-semibold">{formatCPP(cpp)}</span>
                  </span>
                )}
                {onAddPurchase && (
                  <Button size="sm" variant="outline" onClick={() => setBuyOpen(true)} className="gap-1.5 h-7 text-xs">
                    <Plus className="size-3.5" /> Adicionar crédito
                  </Button>
                )}
              </div>
            </div>
            {purchased === 0 && totalCost === 0 ? (
              <div className="text-xs text-muted-foreground">
                Sem compras. Registre plays para acompanhar o saldo.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl bg-[hsl(var(--elevated))] border border-border/40 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1.5">Plays comprados</div>
                  <div className="text-[22px] font-bold tabular-nums leading-none">{formatPlays(purchased)}</div>
                  {totalCost > 0 && (
                    <div className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">{formatBRL(totalCost)} total</div>
                  )}
                </div>
                <div className="rounded-xl bg-[hsl(var(--elevated))] border border-border/40 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1.5">Restante</div>
                  <div className={cn("text-[22px] font-bold tabular-nums leading-none", overbooked ? "text-destructive" : "text-primary")}>
                    {overbooked ? "Estourado" : formatPlays(remaining)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">{formatPlays(consumed)} consumido</div>
                </div>
                <div className="rounded-xl bg-[hsl(var(--elevated))] border border-border/40 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1.5">Consumido</div>
                  <div className="text-[22px] font-bold tabular-nums leading-none">{consumedPct}%</div>
                  <div className="mt-2"><Progress value={consumedPct} className="h-1.5 rounded-full" /></div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Histórico de compras */}
      {(onAddPurchase || purchases.length > 0) && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
              Histórico de compras
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {purchases.length > 0 ? `${purchases.length} última${purchases.length > 1 ? "s" : ""}` : ""}
            </span>
          </div>
          {purchasesLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
              <Loader2 className="size-3.5 animate-spin" /> Carregando histórico…
            </div>
          ) : purchases.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground border border-dashed border-border/40 rounded-xl">
              Nenhuma compra registrada ainda.
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {purchases.map((p) => {
                const date = new Date(p.purchased_at);
                const dateStr = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
                const timeStr = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                const cppPer1k = p.plays_purchased > 0 ? (Number(p.amount) / p.plays_purchased) * 1000 : null;
                return (
                  <div key={p.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-semibold tabular-nums">
                          {Number(p.plays_purchased).toLocaleString("pt-BR")} plays
                        </span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">{formatBRL(Number(p.amount))}</span>
                        {cppPer1k != null && (
                          <span className="text-[10.5px] text-muted-foreground/70 tabular-nums">
                            · {formatBRL(cppPer1k)}/mil
                          </span>
                        )}
                      </div>
                      {p.note && (
                        <div className="text-[11px] text-muted-foreground/80 truncate mt-0.5">{p.note}</div>
                      )}
                    </div>
                    <div className="text-[10.5px] text-muted-foreground/70 tabular-nums whitespace-nowrap text-right">
                      <div>{dateStr}</div>
                      <div>{timeStr}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}


      {/* Catálogo — card próprio com header, filtro e lista (12 visíveis, resto scroll) */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-baseline gap-2">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Catálogo de playlists</div>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {filteredItems.length}{genreFilter ? ` de ${items.length}` : ""}
            </span>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2 h-8">
            <Plus className="size-3.5" /> Adicionar
          </Button>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">Gênero</span>
          <button
            type="button"
            onClick={() => setGenreFilter(null)}
            className={cn(
              "text-[11px] h-6 px-2.5 rounded-full border transition-colors",
              genreFilter === null
                ? "bg-foreground text-background border-foreground"
                : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            Todos
          </button>
          {availableGenres.length === 0 ? (
            <span className="text-[11px] text-muted-foreground/70 italic">sem gêneros registrados ainda</span>
          ) : (
            availableGenres.map((g) => (
              <button
                type="button"
                key={g}
                onClick={() => setGenreFilter((cur) => (cur === g ? null : g))}
                className={cn(
                  "text-[11px] h-6 px-2.5 rounded-full border transition-colors",
                  genreFilter === g
                    ? "bg-foreground text-background border-foreground"
                    : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {g}
              </button>
            ))
          )}
        </div>

        <div className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
              <Loader2 className="size-4 animate-spin" /> Carregando…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-dashed border-border/40">
              <Music className="mx-auto size-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground mb-1">Catálogo vazio.</p>
              <p className="text-xs text-muted-foreground/70">
                As playlists aparecem aqui automaticamente quando usadas em deals, ou cadastre manualmente.
              </p>
            </div>
          ) : (
            <div
              className={cn(
                "space-y-2 pr-1",
                filteredItems.length > 12 && "max-h-[864px] overflow-y-auto",
              )}
            >
              {filteredItems.map((p) => {

              const stat = stats.find((s) => s.library_id === p.id);
              const perf = performance.find((s) => s.library_id === p.id);
              const perfClass = perf?.performance_class ?? "sem_historico";
              const isSuspicious = perfClass === "suspeita";
              const isExcellent = perfClass === "excelente";
              const itemGenres = Array.from(genresByLibrary.get(p.id) ?? []);
              return (
                <div
                  key={p.id}
                  className={cn(
                    "group flex items-center gap-3 p-3 rounded-xl bg-card border transition-colors",
                    isSuspicious
                      ? "border-destructive/40 hover:border-destructive/60"
                      : "border-border/30 hover:border-border hover:bg-[hsl(var(--card-hover,var(--card)))]",
                  )}
                >
                  <div className="size-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {p.image_url ? (
                      <img src={p.image_url} alt="" className="size-full object-cover" />
                    ) : (
                      <ListMusic className="size-5 text-muted-foreground/60" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <p className="font-medium text-sm truncate">{p.playlist_name}</p>
                      {perfClass !== "sem_historico" && perfClass !== "novo" && (
                        <Badge
                          className={cn("text-[10px] h-4 px-1.5 gap-1", PERF_CLASS[perfClass])}
                          title={
                            perf
                              ? `Variação ${perf.variation_coef} · queda ${Math.round(perf.drop_ratio * 100)}% · melhor ${formatPlays(perf.best_streams_7d)} / pior ${formatPlays(perf.worst_streams_7d)}`
                              : undefined
                          }
                        >
                          {isSuspicious && <AlertTriangle className="size-2.5" />}
                          {isExcellent && <Sparkles className="size-2.5" />}
                          {!isSuspicious && !isExcellent && <TrendingUp className="size-2.5" />}
                          {PERF_LABEL[perfClass]}
                        </Badge>
                      )}
                      {p.status === "burned" && (
                        <Badge variant="destructive" className="text-[10px] h-4 px-1.5">queimada</Badge>
                      )}
                      {p.status === "inactive" && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">inativa</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {p.followers ? <span>{formatPlays(p.followers)} seguidores</span> : null}
                      <span>{stat?.deals_count ?? perf?.deals_count ?? 0} deals</span>
                      {stat && stat.avg_streams_per_deal > 0 && (
                        <span>~{formatPlays(stat.avg_streams_per_deal)}/deal</span>
                      )}
                      {itemGenres.length > 0 && (
                        <span className="inline-flex items-center gap-1">
                          {itemGenres.map((g) => (
                            <span
                              key={g}
                              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground border border-border/40"
                            >
                              {g}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {p.spotify_url && (
                      <Button
                        variant="ghost" size="icon" className="size-8"
                        onClick={() => window.open(p.spotify_url, "_blank")}
                      >
                        <ExternalLink className="size-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive"
                      onClick={() => setConfirmDelete(p.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
            </div>
          )}
        </div>
      </div>


      {/* Dialogs */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle>Adicionar playlist</DialogTitle>
              <DraftIndicator lastSavedAt={draft.lastSavedAt} />
            </div>
            <DialogDescription>Catálogo de {curator.name}.</DialogDescription>
          </DialogHeader>
          {draft.hasDraft && (
            <DraftBanner onRestore={handleRestoreDraft} onDiscard={draft.clearDraft} className="mb-2" />
          )}
          <div className="space-y-3">
            <div>
              <Label>Nome da playlist</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Pop BR Hits" />
            </div>
            <div>
              <Label>Link do Spotify</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://open.spotify.com/playlist/…" />
            </div>
            <div>
              <Label>Seguidores (opcional)</Label>
              <Input value={followers} onChange={(e) => setFollowers(e.target.value)} placeholder="50000" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancelar</Button>
            <Button onClick={handleAdd} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin mr-2" />}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover playlist do catálogo?</AlertDialogTitle>
            <AlertDialogDescription>Deals existentes seguem ativos.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={buyOpen} onOpenChange={setBuyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar crédito</DialogTitle>
            <DialogDescription>Nova compra com {curator.name}.</DialogDescription>
          </DialogHeader>
          {(() => {
            const playsNum = Number(String(buyPlays).replace(/\D/g, "")) || 0;
            const amountNum = Number(String(buyAmount).replace(/\./g, "").replace(",", ".")) || 0;
            const fmtInt = (n: number) => n.toLocaleString("pt-BR");
            const fmtBRL = (n: number) =>
              n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
            const playsExtenso = (n: number) => {
              if (n <= 0) return null;
              if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} milhão${n >= 2_000_000 ? "ões" : ""}`;
              if (n >= 1_000) return `${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
              return `${n}`;
            };
            const cpp = playsNum > 0 && amountNum > 0 ? (amountNum / playsNum) * 1000 : null;
            return (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="buy-plays">Plays comprados</Label>
                  <Input
                    id="buy-plays"
                    inputMode="numeric"
                    value={buyPlays}
                    onChange={(e) => setBuyPlays(e.target.value.replace(/\D/g, ""))}
                    placeholder="Ex.: 500000"
                  />
                  <p className="text-[11px] text-muted-foreground min-h-[14px]">
                    {playsNum > 0 ? `= ${fmtInt(playsNum)} plays · ${playsExtenso(playsNum)}` : "Digite a quantidade de plays"}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="buy-amount">Valor pago (R$)</Label>
                  <Input
                    id="buy-amount"
                    inputMode="decimal"
                    value={buyAmount}
                    onChange={(e) => setBuyAmount(e.target.value)}
                    placeholder="Ex.: 1500,00"
                  />
                  <p className="text-[11px] text-muted-foreground min-h-[14px]">
                    {amountNum > 0 ? `= ${fmtBRL(amountNum)}` : "Use vírgula para centavos"}
                  </p>
                </div>
                {cpp != null && (
                  <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                    CPP estimado: <span className="text-foreground font-medium">{fmtBRL(cpp)}</span> por mil plays
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="buy-note">Nota (opcional)</Label>
                  <Input id="buy-note" value={buyNote} onChange={(e) => setBuyNote(e.target.value)} placeholder="Ex.: pacote junho, pix" />
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBuyOpen(false)}>Cancelar</Button>
            <Button onClick={handleBuy} disabled={buying}>
              {buying && <Loader2 className="size-4 animate-spin mr-2" />}
              Adicionar crédito
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
