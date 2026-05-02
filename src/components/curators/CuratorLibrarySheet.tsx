import { useState } from "react";
import { Plus, ExternalLink, ListMusic, Trash2, Loader2, Music } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useCuratorLibrary } from "@/hooks/useCuratorLibrary";
import type { Curator, CuratorDeal } from "@/hooks/useCuratorDeals";

function formatPlays(n: number | null | undefined): string {
  if (!n || !Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return Math.round(n).toLocaleString("pt-BR");
}

interface Props {
  curator: Curator | null;
  deals: CuratorDeal[];
  onClose: () => void;
}

export function CuratorLibrarySheet({ curator, deals, onClose }: Props) {
  const open = !!curator;
  const { items, stats, loading, addManual, remove } = useCuratorLibrary(curator?.id ?? null);

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [followers, setFollowers] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!curator || !name.trim() || !url.trim()) {
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

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent className="sm:max-w-2xl flex flex-col p-0 gap-0">
          {curator && (
            <>
              <SheetHeader className="px-6 py-5 border-b border-border/40">
                <SheetTitle className="text-xl">{curator.name}</SheetTitle>
                <SheetDescription>
                  Biblioteca de playlists e histórico de campanhas.
                </SheetDescription>
              </SheetHeader>

              {/* Métricas */}
              <div className="grid grid-cols-3 gap-px bg-border/30 border-b border-border/40">
                <div className="bg-card p-4">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Playlists
                  </div>
                  <div className="text-xl font-semibold">{items.length}</div>
                </div>
                <div className="bg-card p-4">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Deals
                  </div>
                  <div className="text-xl font-semibold">{deals.length}</div>
                </div>
                <div className="bg-card p-4">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Streams 7d
                  </div>
                  <div className="text-xl font-semibold">
                    {formatPlays(stats.reduce((a, s) => a + (s.total_streams_7d ?? 0), 0))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Catálogo de playlists
                </h3>
                <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
                  <Plus className="size-4" /> Adicionar
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4">
                {loading ? (
                  <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
                    <Loader2 className="size-4 animate-spin" /> Carregando…
                  </div>
                ) : items.length === 0 ? (
                  <div className="text-center py-12">
                    <Music className="mx-auto size-10 text-muted-foreground/40 mb-3" />
                    <p className="text-sm text-muted-foreground mb-1">
                      Nenhuma playlist no catálogo.
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      As playlists aparecem aqui automaticamente quando usadas em deals,
                      ou cadastre manualmente.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {items.map((p) => {
                      const stat = stats.find((s) => s.library_id === p.id);
                      return (
                        <div
                          key={p.id}
                          className={cn(
                            "group flex items-center gap-3 p-3 rounded-xl bg-card border border-border/30 transition-colors",
                            "hover:border-border hover:bg-[hsl(var(--card-hover,var(--card)))]",
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
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="font-medium text-sm truncate">{p.playlist_name}</p>
                              {p.status === "burned" && (
                                <Badge variant="destructive" className="text-[10px] h-4 px-1.5">queimada</Badge>
                              )}
                              {p.status === "inactive" && (
                                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">inativa</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              {p.followers ? <span>{formatPlays(p.followers)} seguidores</span> : null}
                              <span>{stat?.deals_count ?? 0} deals</span>
                              {stat && stat.avg_streams_per_deal > 0 && (
                                <span>~{formatPlays(stat.avg_streams_per_deal)}/deal</span>
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
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar playlist</DialogTitle>
            <DialogDescription>
              Cadastre manualmente uma playlist no catálogo de {curator?.name}.
            </DialogDescription>
          </DialogHeader>
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
            <AlertDialogDescription>
              Os deals já existentes não são afetados — só remove da biblioteca consultiva.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
