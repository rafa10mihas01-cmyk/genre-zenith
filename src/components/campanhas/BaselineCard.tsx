// BaselineCard — mostra a baseline (ponto de partida) registrada na campanha.
// Renderiza só quando existe um upload com is_baseline=true.
import { Card, CardContent } from "@/components/ui/card";
import { Flag } from "lucide-react";

type Props = {
  capturedAt: string;
  totalStreams: number;
  playlistsDetected: number;
  fileName?: string | null;
};

function fmt(n: number) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

export function BaselineCard({ capturedAt, totalStreams, playlistsDetected, fileName }: Props) {
  const date = new Date(capturedAt);
  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Flag className="h-4 w-4 text-primary mt-0.5" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">Baseline registrada</h3>
                <span className="text-[10px] uppercase tracking-wide border border-primary/40 text-primary rounded px-1.5 py-0.5 font-medium">
                  Referência
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 max-w-md">
                Ponto de partida da campanha. Os streams entregues são calculados a partir
                deste momento — tudo que já existia antes não conta como entrega.
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Capturada</div>
            <div className="text-sm font-medium text-foreground mt-0.5">
              {date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Streams iniciais</div>
            <div className="text-xl font-semibold text-foreground tabular-nums mt-0.5">{fmt(totalStreams)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">soma das playlists na partida</div>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Playlists detectadas</div>
            <div className="text-xl font-semibold text-foreground tabular-nums mt-0.5">{fmt(playlistsDetected)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">capturadas no snapshot inicial</div>
          </div>
        </div>

        {fileName && (
          <div className="text-[11px] text-muted-foreground border-t border-border/60 pt-2">
            Arquivo: <span className="text-foreground/80">{fileName}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
