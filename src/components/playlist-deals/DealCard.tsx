import { memo } from "react";
import { Camera, History, Trash2, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { computeStats, type PlaylistDeal, type PlaylistDealLog } from "@/lib/playlistDealsUtils";

type DealStatus = "delivering" | "slow" | "stuck" | "done" | "no_data";

const STATUS_META: Record<DealStatus, { label: string; cls: string; icon: any }> = {
  delivering: { label: "Entregando", cls: "text-success bg-success/15 border-success/30", icon: TrendingUp },
  slow:       { label: "Lento",      cls: "text-warning bg-warning/15 border-warning/30", icon: TrendingDown },
  stuck:      { label: "Travado",    cls: "text-destructive bg-destructive/15 border-destructive/30", icon: AlertTriangle },
  done:       { label: "Concluído",  cls: "text-success bg-success/15 border-success/30", icon: CheckCircle2 },
  no_data:    { label: "Sem dados",  cls: "text-muted-foreground bg-muted/30 border-border", icon: Minus },
};

function classifyDeal(args: {
  earned: number;
  target: number;
  vel: number | null;
  logsCount: number;
}): DealStatus {
  const { earned, target, vel, logsCount } = args;
  if (logsCount === 0) return "no_data";
  if (target > 0 && earned >= target) return "done";
  if (vel === null || vel === 0) return "stuck";
  if (vel > 500) return "delivering";
  return "slow";
}

function formatPlays(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    const v = n / 1_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}k`;
  }
  return Math.round(n).toString();
}

export interface DealCardProps {
  deal: PlaylistDeal;
  logs: PlaylistDealLog[];
  onLog: (deal: PlaylistDeal) => void;
  onDetail: (deal: PlaylistDeal) => void;
  onDelete: (deal: PlaylistDeal) => void;
}

export const DealCard = memo(function DealCard({
  deal, logs, onLog, onDetail, onDelete,
}: DealCardProps) {
  const stats = computeStats(deal, logs);
  const { earned, pct, vel, eta, dealLogs } = stats;

  const status = classifyDeal({
    earned,
    target: Number(deal.target ?? 0),
    vel,
    logsCount: dealLogs.length,
  });
  const meta = STATUS_META[status];
  const StatusIcon = meta.icon;

  return (
    <Card className="overflow-hidden hover:border-foreground/25 transition-colors">
      <CardContent className="p-5 flex flex-col gap-4">
        {/* Header — song / playlist / curator + status */}
        <div className="flex items-start justify-between gap-3 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground truncate" title={deal.song}>
              {deal.song}
            </div>
            <div className="text-sm text-muted-foreground truncate" title={deal.playlist}>
              {deal.playlist}
            </div>
            {deal.curator && (
              <div className="text-xs text-muted-foreground/80 truncate mt-0.5" title={deal.curator}>
                {deal.curator}
              </div>
            )}
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1 px-2 h-6 rounded-full border text-[11px] font-medium shrink-0",
              meta.cls,
            )}
          >
            <StatusIcon className="h-3 w-3" />
            {meta.label}
          </span>
        </div>

        {/* Progress */}
        <div className="space-y-1.5">
          <Progress value={pct} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
            <span>
              <span className="text-foreground font-medium">{formatPlays(earned)}</span>
              {" / "}
              {formatPlays(Number(deal.target ?? 0))} plays
            </span>
            <span className="font-medium text-foreground">{pct}%</span>
          </div>
        </div>

        {/* Velocity / ETA */}
        {(vel !== null || (eta !== null && eta > 0)) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
            {vel !== null && (
              <span>⚡ <span className="text-foreground font-medium">{formatPlays(Math.round(vel))}</span>/dia</span>
            )}
            {eta !== null && eta > 0 && (
              <span>⏱ ~<span className="text-foreground font-medium">{eta}</span> dias para a meta</span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5"
            onClick={() => onLog(deal)}
          >
            <Camera className="h-3.5 w-3.5" />
            Enviar print
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => onDetail(deal)}
          >
            <History className="h-3.5 w-3.5" />
            Histórico
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(deal)}
            aria-label="Excluir deal"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});
