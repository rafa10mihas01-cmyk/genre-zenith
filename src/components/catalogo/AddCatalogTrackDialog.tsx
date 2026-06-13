// AddCatalogTrackDialog — modal pra distribuir uma música no catálogo.
// Aceita URL, URI ou Spotify Track ID. Invoca a edge function `distribute-catalog-track`
// que resolve a faixa no Spotify e chama a RPC atômica `distribute_catalog_track`.
import { useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Result = {
  ok: boolean;
  error?: string;
  message?: string;
  track?: {
    track_name: string;
    artist_name: string;
    cover_url: string | null;
    is_new: boolean;
  };
  total_eligible_playlists?: number;
  skipped_already_present?: number;
  skipped_no_capacity?: number;
  placements_created?: number;
  distribution_batch_id?: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDistributed?: () => void;
}

export function AddCatalogTrackDialog({ open, onOpenChange, onDistributed }: Props) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const reset = () => {
    setInput("");
    setResult(null);
    setLoading(false);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const distribute = async () => {
    const value = input.trim();
    if (!value) return;
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("distribute-catalog-track", {
        body: { input: value },
      });
      if (error) {
        setResult({ ok: false, error: "request_failed", message: error.message });
      } else {
        setResult(data as Result);
        if ((data as Result)?.ok) onDistributed?.();
      }
    } catch (e) {
      setResult({ ok: false, error: "exception", message: (e as Error)?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar música ao catálogo</DialogTitle>
          <DialogDescription>
            Cola a URL, URI ou Spotify ID da faixa. A distribuição é automática para todas
            as playlists do catálogo com capacidade disponível.
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="space-y-3">
            <Label htmlFor="track-input">Spotify URL, URI ou Track ID</Label>
            <Input
              id="track-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://open.spotify.com/track/..."
              autoFocus
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading && input.trim()) distribute();
              }}
            />
            <p className="text-xs text-muted-foreground">
              Não há filtros de score, followers ou performance. Apenas duplicidade e
              capacidade bloqueiam a distribuição.
            </p>
          </div>
        )}

        {result?.ok && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/10 border border-primary/30">
              <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div className="space-y-1 min-w-0">
                <div className="font-semibold">{result.track?.track_name}</div>
                <div className="text-sm text-muted-foreground">{result.track?.artist_name}</div>
                <div className="text-xs text-muted-foreground">
                  {result.track?.is_new ? "Música nova adicionada ao catálogo." : "Música já existia — expansão para playlists novas."}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-lg bg-muted/40">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Elegíveis</div>
                <div className="text-2xl font-semibold tabular-nums">{result.total_eligible_playlists ?? 0}</div>
              </div>
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/30">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Placements criados</div>
                <div className="text-2xl font-semibold tabular-nums text-primary">
                  {result.placements_created ?? 0}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-muted/40">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Já presente</div>
                <div className="text-xl font-semibold tabular-nums">{result.skipped_already_present ?? 0}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/40">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Sem vaga</div>
                <div className="text-xl font-semibold tabular-nums">{result.skipped_no_capacity ?? 0}</div>
              </div>
            </div>
          </div>
        )}

        {result && !result.ok && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/30">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
            <div className="space-y-1 min-w-0">
              <div className="font-semibold text-destructive">Falha na distribuição</div>
              <div className="text-sm text-muted-foreground break-words">
                {result.message ?? result.error ?? "Erro desconhecido"}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              <Button variant="outline" onClick={() => handleClose(false)}>Fechar</Button>
              <Button onClick={reset}>Adicionar outra</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={loading}>
                Cancelar
              </Button>
              <Button onClick={distribute} disabled={loading || !input.trim()} className="gap-2">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? "Distribuindo…" : "Distribuir"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
