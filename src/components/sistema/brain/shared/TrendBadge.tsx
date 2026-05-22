// TrendBadge — direção visual: subindo / caindo / estável.
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export function TrendBadge({ delta, suffix = "%" }: { delta: number | null; suffix?: string }) {
  if (delta == null || !isFinite(delta)) {
    return <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Minus className="h-3 w-3" /> —</span>;
  }
  const up = delta > 0.5;
  const down = delta < -0.5;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  const cls = up ? "text-success" : down ? "text-destructive" : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium", cls)}>
      <Icon className="h-3 w-3" />
      {delta > 0 ? "+" : ""}{delta.toFixed(1)}{suffix}
    </span>
  );
}
