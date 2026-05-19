import { cn } from "@/lib/utils";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";

export type PlaylistScoreRow = {
  health_score: number;
  delivery_score: number;
  capacity_score: number;
  risk_score: number;
  activity_score: number;
  calculated_at?: string;
};

function tone(value: number, invert = false): "success" | "warning" | "danger" | "muted" {
  const v = invert ? 100 - value : value;
  if (v >= 70) return "success";
  if (v >= 40) return "warning";
  if (v > 0) return "danger";
  return "muted";
}

const TONE_TEXT: Record<string, string> = {
  success: "text-primary",
  warning: "text-warning",
  danger: "text-destructive",
  muted: "text-muted-foreground",
};

const TONE_BAR: Record<string, string> = {
  success: "bg-primary",
  warning: "bg-warning",
  danger: "bg-destructive",
  muted: "bg-muted-foreground/30",
};

export function PlaylistScoreBadge({ scores }: { scores: PlaylistScoreRow | null }) {
  if (!scores) return null;
  const h = scores.health_score;
  const t = tone(h);
  const rows: Array<{ label: string; value: number; invert?: boolean }> = [
    { label: "Capacidade", value: scores.capacity_score },
    { label: "Entrega",    value: scores.delivery_score },
    { label: "Atividade",  value: scores.activity_score },
    { label: "Risco",      value: scores.risk_score, invert: true },
  ];

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={`Health score ${h} de 100`}
            className={cn(
              "inline-flex items-center justify-center w-[18px] h-[18px] rounded-full border text-[9px] font-bold tabular-nums shrink-0 leading-none",
              t === "success" && "border-primary/40 bg-primary/15 text-primary",
              t === "warning" && "border-warning/50 bg-warning/15 text-warning",
              t === "danger"  && "border-destructive/40 bg-destructive/15 text-destructive",
              t === "muted"   && "border-border bg-elevated text-muted-foreground",
            )}
          >
            {h}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px]">
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-foreground">Health score {h}/100</div>
            <div className="text-[11px] text-muted-foreground leading-relaxed">
              Pontuação geral de saúde da playlist, combinando capacidade, entrega, atividade e risco.
            </div>
            <div className="grid grid-cols-[auto_60px_auto] gap-x-2 gap-y-1 items-center pt-1">
              {rows.map((r) => {
                const tt = tone(r.value, r.invert);
                return (
                  <div key={r.label} className="contents">
                    <span className="text-[11px] text-muted-foreground">{r.label}</span>
                    <span className="h-1 rounded-full bg-muted overflow-hidden">
                      <span
                        className={cn("block h-full", TONE_BAR[tt])}
                        style={{ width: `${r.value}%` }}
                      />
                    </span>
                    <span className={cn("text-[11px] font-semibold tabular-nums", TONE_TEXT[tt])}>{r.value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
