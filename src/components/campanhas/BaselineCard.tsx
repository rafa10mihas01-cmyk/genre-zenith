// BaselineCard — versão compacta e clicável. Resumo da baseline + CTA pra
// aba "Baseline" no hub da campanha (com lista completa de playlists).
import { Card, CardContent } from "@/components/ui/card";
import { Flag, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  capturedAt: string;
  totalStreams: number;
  playlistsDetected: number;
  onClick?: () => void;
};

function fmt(n: number) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

export function BaselineCard({ capturedAt, totalStreams, playlistsDetected, onClick }: Props) {
  const date = new Date(capturedAt);
  const dateLabel = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <Card
      onClick={onClick}
      className={cn(
        "border-border/60 bg-card transition-colors",
        onClick && "cursor-pointer hover:bg-muted/30 hover:border-primary/40",
      )}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <CardContent className="p-4 flex items-stretch gap-0">
        {/* Bloco 1 — Identidade */}
        <div className="flex items-center gap-2.5 pr-4 min-w-0">
          <Flag className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold text-foreground">Baseline</span>
          <span className="text-[9px] uppercase tracking-wider border border-primary/40 text-primary rounded px-1.5 py-0.5 font-semibold leading-none">
            Ref
          </span>
        </div>

        {/* Divisor + KPIs */}
        <div className="flex items-center ml-auto shrink-0 divide-x divide-border/60">
          <div className="px-4 text-center">
            <div className="text-base font-semibold tabular-nums text-foreground leading-none">{fmt(playlistsDetected)}</div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">Playlists</div>
          </div>
          <div className="px-4 text-center">
            <div className="text-base font-semibold tabular-nums text-foreground leading-none">{fmt(totalStreams)}</div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">Streams</div>
          </div>
          {onClick && (
            <div className="pl-3 flex items-center">
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
