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
      <CardContent className="p-3.5 flex items-center gap-3">
        <Flag className="h-3.5 w-3.5 text-primary shrink-0" />
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground">Baseline</span>
          <span className="text-[10px] uppercase tracking-wide border border-primary/40 text-primary rounded px-1 py-px font-medium">
            Ref
          </span>
        </div>
        <div className="text-xs text-muted-foreground hidden sm:block">·</div>
        <div className="text-xs text-muted-foreground truncate hidden sm:block">{dateLabel}</div>
        <div className="ml-auto flex items-center gap-4 shrink-0">
          <div className="text-right">
            <div className="text-sm font-semibold tabular-nums text-foreground leading-tight">{fmt(playlistsDetected)}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">playlists</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold tabular-nums text-foreground leading-tight">{fmt(totalStreams)}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">streams</div>
          </div>
          {onClick && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </CardContent>
    </Card>
  );
}
