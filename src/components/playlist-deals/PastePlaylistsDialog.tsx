import { useState } from "react";
import { Loader2, Sparkles, ClipboardPaste } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { CuratorDeal, CuratorMatchStatus } from "@/lib/curatorDealsUtils";

type EnrichResult = {
  name: string;
  spotify_url: string | null;
  match_status: CuratorMatchStatus;
  match_reason: string;
  streams_7d: number;
  streams_28d: number;
  streams_total: number;
  followers: number | null;
  added_at: string | null;
  position: number | null;
  isNew: boolean;
  error?: string;
};

type EnrichResponse = {
  ok: boolean;
  error?: string;
  dry_run?: boolean;
  counts?: {
    new: number;
    baseline: number;
    editorial: number;
    curator: number;
    suspicious: number;
    organic: number;
    total: number;
  };
  total_streams_7d?: number;
  results?: EnrichResult[];
};

const STATUS_LABEL: Record<CuratorMatchStatus, string> = {
  curator: "Do curador",
  baseline: "Inicial",
  editorial: "Editorial",
  suspicious: "Suspeita",
  organic: "Orgânica",
};

const STATUS_CLASS: Record<CuratorMatchStatus, string> = {
  curator: "bg-success/15 text-success border-0",
  baseline: "bg-muted/40 text-muted-foreground border border-border",
  editorial: "bg-primary/15 text-primary border-0",
  suspicious: "bg-destructive/15 text-destructive border-0",
  organic: "bg-muted/30 text-muted-foreground border border-border",
};

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Math.round(n).toLocaleString("pt-BR");
}

export interface PastePlaylistsDialogProps {
  open: boolean;
  deal: CuratorDeal | null;
  onClose: () => void;
  onImported?: () => void;
}

export function PastePlaylistsDialog({
  open, deal, onClose, onImported,
}: PastePlaylistsDialogProps) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<EnrichResponse | null>(null);

  const reset = () => {
    setText("");
    setPreview(null);
    setLoading(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const callEnrich = async (dryRun: boolean) => {
    if (!deal) return;
    if (text.trim().length < 10) {
      toast.error("Cole o texto da página do Spotify for Artists");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<EnrichResponse>(
        "enrich-curator-paste",
        { body: { deal_id: deal.id, text, dry_run: dryRun } },
      );
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.error ?? "Falha ao processar");
        return;
      }
      setPreview(data);
      if (!dryRun) {
        toast.success(
          `Importadas ${data.counts?.total ?? 0} playlists (${data.counts?.new ?? 0} novas)`,
        );
        onImported?.();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-medium text-base">
            Colar dados do Spotify for Artists
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Copie a tela "Playlists" da música no Spotify for Artists e cole aqui.
            A IA extrai e classifica cada playlist (do curador, editorial, suspeita…).
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4 min-h-0">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Cole aqui o texto copiado do Spotify for Artists…"
            className="min-h-[160px] max-h-[260px] font-mono text-xs"
            disabled={loading}
          />

          {preview && preview.results && (
            <div className="flex flex-col gap-2 min-h-0">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  {preview.dry_run ? "Pré-visualização" : "Resultado"}
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {preview.counts?.curator ? (
                    <Badge className={STATUS_CLASS.curator}>
                      {preview.counts.curator} curador
                    </Badge>
                  ) : null}
                  {preview.counts?.baseline ? (
                    <Badge className={STATUS_CLASS.baseline}>
                      {preview.counts.baseline} inicial
                    </Badge>
                  ) : null}
                  {preview.counts?.editorial ? (
                    <Badge className={STATUS_CLASS.editorial}>
                      {preview.counts.editorial} editorial
                    </Badge>
                  ) : null}
                  {preview.counts?.suspicious ? (
                    <Badge className={STATUS_CLASS.suspicious}>
                      {preview.counts.suspicious} suspeita
                    </Badge>
                  ) : null}
                  {preview.counts?.organic ? (
                    <Badge className={STATUS_CLASS.organic}>
                      {preview.counts.organic} orgânica
                    </Badge>
                  ) : null}
                </div>
              </div>
              <ScrollArea className="h-[280px] rounded-md border border-border">
                <ul className="divide-y divide-border">
                  {preview.results.map((r, i) => (
                    <li key={i} className="px-3 py-2 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-foreground truncate">
                            {r.name}
                          </span>
                          <Badge
                            className={cn(
                              "shrink-0 text-[10px] h-4 px-1.5",
                              STATUS_CLASS[r.match_status],
                            )}
                          >
                            {STATUS_LABEL[r.match_status]}
                          </Badge>
                          {r.isNew && !preview.dry_run && (
                            <Badge className="shrink-0 text-[10px] h-4 px-1.5 bg-primary/15 text-primary border-0">
                              nova
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {r.match_reason}
                          {r.added_at && ` · adicionada ${r.added_at}`}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-medium text-foreground">
                          {fmt(r.streams_7d)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          plays 7d
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
              {typeof preview.total_streams_7d === "number" && (
                <div className="text-xs text-muted-foreground text-right">
                  Total 7 dias: <span className="text-foreground font-medium">
                    {fmt(preview.total_streams_7d)}
                  </span> plays
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={handleClose} disabled={loading}>
            Fechar
          </Button>
          <Button
            variant="outline"
            onClick={() => callEnrich(true)}
            disabled={loading || text.trim().length < 10}
            className="gap-2"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Pré-visualizar
          </Button>
          <Button
            onClick={() => callEnrich(false)}
            disabled={loading || text.trim().length < 10}
            className="gap-2"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ClipboardPaste className="h-4 w-4" />
            )}
            Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
