import { useEffect, useMemo, useState } from "react";
import { Loader2, Library, Search, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCuratorLibrary } from "@/hooks/useCuratorLibrary";
import type { CuratorDeal, CuratorPlaylist } from "@/lib/curatorDealsUtils";

export interface ImportFromLibraryDialogProps {
  open: boolean;
  deal: CuratorDeal | null;
  existingPlaylists: CuratorPlaylist[];
  onClose: () => void;
  onImported?: () => void;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("pt-BR");
}

export function ImportFromLibraryDialog({
  open,
  deal,
  existingPlaylists,
  onClose,
  onImported,
}: ImportFromLibraryDialogProps) {
  const curatorId = deal?.curator_id ?? null;
  const { items, loading } = useCuratorLibrary(open ? curatorId : null);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelected(new Set());
      setSubmitting(false);
    }
  }, [open]);

  // IDs já presentes no deal — não permitir duplicar
  const existingKeys = useMemo(() => {
    const set = new Set<string>();
    existingPlaylists.forEach((p) => {
      if (p.spotify_playlist_id) set.add(`id:${p.spotify_playlist_id}`);
      else if (p.playlist_name) set.add(`name:${p.playlist_name.trim().toLowerCase()}`);
    });
    return set;
  }, [existingPlaylists]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items
      .filter((p) => p.status === "active")
      .filter((p) => (term ? p.playlist_name.toLowerCase().includes(term) : true));
  }, [items, search]);

  const toggle = (id: string, alreadyInDeal: boolean) => {
    if (alreadyInDeal) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = async () => {
    if (!deal) return;
    if (selected.size === 0) {
      toast.error("Selecione ao menos uma playlist");
      return;
    }
    setSubmitting(true);
    try {
      const chosen = items.filter((p) => selected.has(p.id));
      const rows = chosen.map((p) => ({
        deal_id: deal.id,
        playlist_name: p.playlist_name,
        spotify_url: p.spotify_url,
        spotify_playlist_id: p.spotify_playlist_id,
        spotify_owner_id: p.spotify_owner_id,
        spotify_owner_name: p.spotify_owner_name,
        followers: p.followers,
        image_url: p.image_url,
        match_status: "curator" as const,
        match_reason: "Importada da biblioteca do curador",
        is_baseline: false,
        // Streams sempre zerados — deal novo começa do zero
        streams_total: 0,
        streams_28d: 0,
        streams_7d: 0,
      }));
      const { error } = await supabase.from("curator_playlists").insert(rows);
      if (error) throw error;
      toast.success(
        `${rows.length} playlist${rows.length > 1 ? "s" : ""} importada${rows.length > 1 ? "s" : ""} do catálogo`,
      );
      onImported?.();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Não foi possível importar", { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-medium text-base flex items-center gap-2">
            <Library className="h-4 w-4" />
            Importar do catálogo
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Selecione playlists já cadastradas no histórico deste curador. Os streams começam zerados neste deal.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-3 min-h-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar playlist..."
              className="pl-9 h-9 text-sm"
              disabled={loading || submitting}
            />
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-10 text-center gap-2">
              <Library className="h-8 w-8 text-muted-foreground/40" />
              <div className="text-sm text-foreground">Nenhuma playlist no catálogo</div>
              <div className="text-xs text-muted-foreground max-w-xs">
                {items.length === 0
                  ? "Este curador ainda não tem playlists registradas. Use Colar dados em qualquer deal para começar a popular o catálogo."
                  : "Nenhum resultado para essa busca."}
              </div>
            </div>
          ) : (
            <ScrollArea className="h-[360px] rounded-md border border-border">
              <ul className="divide-y divide-border">
                {visible.map((p) => {
                  const key = p.spotify_playlist_id
                    ? `id:${p.spotify_playlist_id}`
                    : `name:${p.playlist_name.trim().toLowerCase()}`;
                  const alreadyInDeal = existingKeys.has(key);
                  const isSelected = selected.has(p.id);
                  return (
                    <li
                      key={p.id}
                      onClick={() => toggle(p.id, alreadyInDeal)}
                      className={cn(
                        "px-3 py-2.5 flex items-center gap-3 transition-colors",
                        alreadyInDeal
                          ? "opacity-50 cursor-not-allowed"
                          : "cursor-pointer hover:bg-muted/30",
                        isSelected && "bg-primary/5",
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded border flex items-center justify-center shrink-0",
                          isSelected
                            ? "bg-primary border-primary"
                            : "border-border bg-background",
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-foreground truncate">
                            {p.playlist_name}
                          </span>
                          {alreadyInDeal && (
                            <Badge className="shrink-0 text-[10px] h-4 px-1.5 bg-muted/40 text-muted-foreground border-0">
                              já no deal
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {fmt(p.followers)} seguidores · usada em {p.times_used} deal{p.times_used !== 1 ? "s" : ""}
                          {p.spotify_owner_name && ` · ${p.spotify_owner_name}`}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleImport}
            disabled={submitting || selected.size === 0}
            className="gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Importar {selected.size > 0 && `(${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
