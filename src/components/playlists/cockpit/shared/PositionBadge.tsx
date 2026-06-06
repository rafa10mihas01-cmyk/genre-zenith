import { cn } from "@/lib/utils";

export function PositionBadge({ from, to }: { from: number; to: number | null }) {
  return (
    <div className="flex items-center gap-1 text-[11px] font-mono tabular-nums shrink-0 w-20">
      <span className="text-muted-foreground">#{from}</span>
      <span className="text-muted-foreground/50">→</span>
      <span className={cn("font-semibold", to == null ? "text-destructive" : "text-primary")}>
        {to == null ? "—" : `#${to}`}
      </span>
    </div>
  );
}
