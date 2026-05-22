import { TrendingDown, TrendingUp, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeliveryStatusRow } from "@/hooks/useDeliveryStatus";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  row?: DeliveryStatusRow | null;
  className?: string;
}

/**
 * Badge sutil que mostra aderência real vs plano de entrega.
 * Só renderiza se o status for diferente de on_track.
 */
export function DealDeliveryBadge({ row, className }: Props) {
  if (!row || row.status === "on_track" || row.status === "paused") return null;

  const isLag = row.status === "lagging";
  const hasSpamSpike = (row.spike_playlist_ids?.length ?? 0) >= 3;
  const Icon = isLag ? TrendingDown : hasSpamSpike ? ShieldAlert : TrendingUp;
  const label = isLag ? "Atrasado" : hasSpamSpike ? "Spike anti-spam" : "Acima do plano";
  const tone = isLag
    ? "border-amber-500/30 text-amber-400 bg-amber-500/5"
    : hasSpamSpike
    ? "border-rose-500/40 text-rose-400 bg-rose-500/5"
    : "border-emerald-500/30 text-emerald-400 bg-emerald-500/5";

  const pct = Math.round(row.delta_pct * 100);
  const tip = `${row.reason ?? label} · esperado ${row.expected_to_date.toLocaleString("pt-BR")} · real ${row.actual_to_date.toLocaleString("pt-BR")} (${pct >= 0 ? "+" : ""}${pct}%)`;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
              tone,
              className,
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] text-[11px]">
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
