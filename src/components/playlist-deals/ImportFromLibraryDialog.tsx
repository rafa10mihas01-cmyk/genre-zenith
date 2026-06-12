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
import type { CuratorDeal, CuratorDealSong, CuratorPlaylist } from "@/lib/curatorDealsUtils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface ImportFromLibraryDialogProps {
  open: boolean;
  deal: CuratorDeal | null;
  songs?: CuratorDealSong[];
  existingPlaylists: CuratorPlaylist[];
  initialSongId?: string | null;
  onClose: () => void;
  onImported?: () => void;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("pt-BR");
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const obj = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    return [obj.message, obj.details, obj.hint, obj.code].filter(Boolean).map(String).join(" · ") || "Erro desconhecido";
  }
  return String(e || "Erro desconhecido");
}

export function ImportFromLibraryDialog({
  open,
  deal,
  songs = [],
  existingPlaylists,
  initialSongId = null,
  onClose,
  onImported,
}: ImportFromLibraryDialogProps) {
  const curatorId = deal?.curator_id ?? null;
  const { items, loading } = useCuratorLibrary(open ? curatorId : null);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const multiSong = songs.length >= 2;
  const [songId, setSongId] = useState<string>("");

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelected(new Set());
      setSubmitting(false);
      setSongId("");
    } else if (multiSong && !songId && songs[0]) {
      const initial = initialSongId && songs.some((s) => s.id === initialSongId)
        ? initialSongId
        : songs[0].id;
      setSongId(initial);
    }
  }, [open, multiSong, songs, songId, initialSongId]);

  // Mapa de playlists já presentes no deal, mantendo a música vinculada.
  // A mesma playlist pode existir em músicas diferentes; só bloqueia duplicata
  // quando já é curator na MESMA música selecionada.
  const existingMap = useMemo(() => {
    const map = new Map<string, { id: string; status: string; songId: string | null }[]>();
    existingPlaylists.filter((p) => p.deal_id === deal?.id).forEach((p) => {
      const status = (p as any).match_status ?? "organic";
      const entry = { id: p.id, status, songId: (p as any).song_id ?? null };
      const add = (key: string) => map.set(key, [...(map.get(key) ?? []), entry]);
      if (p.spotify_playlist_id) add(`id:${p.spotify_playlist_id}`);
      else if (p.playlist_name) add(`name:${p.playlist_name.trim().toLowerCase()}`);
    });
    return map;
  }, [existingPlaylists, deal?.id]);

  const targetSongId = multiSong ? songId : (songs[0]?.id ?? null);

  const getExistingForTarget = (key: string) => {
    const rows = existingMap.get(key) ?? [];
    return rows.find((row) => row.songId === targetSongId) ?? null;
  };

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
    if (multiSong && !songId) {
      toast.error("Selecione a música deste deal");
      return;
    }
    setSubmitting(true);
    try {
      const chosen = items.filter((p) => selected.has(p.id));
      // Separar: novas (insert) vs já existentes como organic/etc (promote → update)
      const toInsert: any[] = [];
      const toPromote: { id: string }[] = [];
      for (const p of chosen) {
        const key = p.spotify_playlist_id
          ? `id:${p.spotify_playlist_id}`
          : `name:${p.playlist_name.trim().toLowerCase()}`;
        const current = getExistingForTarget(key);
        if (current && current.status !== "curator") {
          toPromote.push({ id: current.id });
        } else if (!current) {
          toInsert.push({
            deal_id: deal.id,
            song_id: targetSongId,
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
            streams_total: 0,
            streams_28d: 0,
            streams_7d: 0,
          });
        }
      }

      if (toInsert.length) {
        const { error } = await supabase.from("curator_playlists").insert(toInsert);
        if (error) throw error;
      }
      for (const pr of toPromote) {
        const { error } = await supabase
          .from("curator_playlists")
          .update({
            match_status: "curator",
            match_reason: "Promovida do orgânico via catálogo do curador",
          })
          .eq("id", pr.id);
        if (error) throw error;
      }

      const total = toInsert.length + toPromote.length;
      toast.success(
        `${total} playlist${total > 1 ? "s" : ""} ${toPromote.length > 0 ? "atualizada" : "importada"}${total > 1 ? "s" : ""} do catálogo`,
      );
      onImported?.();
      onClose();
    } catch (e) {
      const msg = errorMessage(e);
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
          {multiSong && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Vincular à música</label>
              <Select value={songId} onValueChange={setSongId} disabled={submitting}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecione a música" />
                </SelectTrigger>
                <SelectContent>
                  {songs.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.song_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
              <div className="text-sm text-foreground">Catálogo vazio</div>
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
                  const current = getExistingForTarget(key);
                  const isCurator = current?.status === "curator";
                  const isOrganic = !!current && !isCurator;
                  const isEcosystem = !!p.is_ecosystem;
                  const blocked = isCurator || isEcosystem; // ecossistema também bloqueia
                  const isSelected = selected.has(p.id);
                  return (
                    <li
                      key={p.id}
                      onClick={() => toggle(p.id, blocked)}
                      className={cn(
                        "px-3 py-2.5 flex items-center gap-3 transition-colors",
                        blocked
                          ? "opacity-50 cursor-not-allowed"
                          : "cursor-pointer hover:bg-muted/30",
                        isSelected && "bg-primary/5",
                      )}
                      title={isEcosystem ? "Playlist do ecossistema NexEngine — não pode ser declarada como playlist do curador" : undefined}
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
                          {isEcosystem && (
                            <Badge className="shrink-0 text-[10px] h-4 px-1.5 bg-primary/15 text-primary border-0">
                              ecossistema
                            </Badge>
                          )}
                          {isCurator && (
                            <Badge className="shrink-0 text-[10px] h-4 px-1.5 bg-muted/40 text-muted-foreground border-0">
                              já no deal
                            </Badge>
                          )}
                          {isOrganic && (
                            <Badge className="shrink-0 text-[10px] h-4 px-1.5 bg-primary/10 text-primary border-0">
                              promover a curador
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
