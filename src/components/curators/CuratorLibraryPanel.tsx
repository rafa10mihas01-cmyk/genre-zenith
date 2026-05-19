// CuratorLibraryPanel — corpo reutilizável da biblioteca + saldo do curador.
// Renderiza KPIs, saldo e catálogo. Sem Sheet/Dialog wrapper — usado tanto pelo
// CuratorLibrarySheet (drawer legado) quanto pela página dedicada /curadores/:id.
import { useState } from "react";
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

  const px = flush ? "px-0" : "px-6";

  return (
    <>
      {/* Métricas */}
      <div className="grid grid-cols-3 gap-px bg-border/30 rounded-xl overflow-hidden border border-border/40">
        <div className="bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Playlists</div>
          <div className="text-xl font-semibold">{items.length}</div>
        </div>
        <div className="bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Deals</div>
          <div className="text-xl font-semibold">{deals.length}</div>
        </div>
        <div className="bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Streams 7d</div>
          <div className="text-xl font-semibold">
            {formatPlays(stats.reduce((a, s) => a + (s.total_streams_7d ?? 0), 0))}
          </div>
        </div>
      </div>

      {/* Saldo */}
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
          <div className="mt-4 rounded-xl border border-border/40 bg-[hsl(var(--elevated))] p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Saldo</h3>
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
                <div className="rounded-xl bg-card border border-border/40 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1.5">Plays comprados</div>
                  <div className="text-[22px] font-bold tabular-nums leading-none">{formatPlays(purchased)}</div>
                  {totalCost > 0 && (
                    <div className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">{formatBRL(totalCost)} total</div>
                  )}
                </div>
                <div className="rounded-xl bg-card border border-border/40 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1.5">Restante</div>
                  <div className={cn("text-[22px] font-bold tabular-nums leading-none", overbooked ? "text-destructive" : "text-primary")}>
                    {overbooked ? "Estourado" : formatPlays(remaining)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">{formatPlays(consumed)} consumido</div>
                </div>
                <div className="rounded-xl bg-card border border-border/40 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1.5">Consumido</div>
                  <div className="text-[22px] font-bold tabular-nums leading-none">{consumedPct}%</div>
                  <div className="mt-2"><Progress value={consumedPct} className="h-1.5 rounded-full" /></div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Catálogo */}
      <div className="mt-6 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Catálogo de playlists</h3>
        <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
          <Plus className="size-4" /> Adicionar
        </Button>
      </div>

      {availableGenres.length > 0 && (
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
          {availableGenres.map((g) => (
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
          ))}
        </div>
      )}

      <div className="mt-3">
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
          <div className="space-y-2">
            {items
              .filter((p) => !genreFilter || genresByLibrary.get(p.id)?.has(genreFilter))
              .map((p) => {
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
          <div className="space-y-3">
            <div>
              <Label>Plays comprados</Label>
              <Input inputMode="numeric" value={buyPlays} onChange={(e) => setBuyPlays(e.target.value)} placeholder="Ex.: 500000" />
            </div>
            <div>
              <Label>Valor pago (R$)</Label>
              <Input inputMode="decimal" value={buyAmount} onChange={(e) => setBuyAmount(e.target.value)} placeholder="Ex.: 1500,00" />
            </div>
            <div>
              <Label>Nota (opcional)</Label>
              <Input value={buyNote} onChange={(e) => setBuyNote(e.target.value)} placeholder="Ex.: pacote junho, pix" />
            </div>
          </div>
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
