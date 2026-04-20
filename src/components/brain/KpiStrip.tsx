import { cn } from "@/lib/utils";

export interface Kpi {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "success" | "warning" | "muted";
}

export function KpiStrip({ items, className }: { items: Kpi[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-px bg-border rounded-lg overflow-hidden border border-border", className)}>
      {items.map((k) => (
        <div key={k.label} className="bg-card px-4 py-3 flex flex-col gap-0.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{k.label}</div>
          <div className={cn(
            "text-xl font-bold tabular-nums leading-tight",
            k.tone === "success" && "text-[hsl(var(--success))]",
            k.tone === "warning" && "text-[hsl(var(--warning))]",
            k.tone === "muted" && "text-muted-foreground",
          )}>
            {k.value}
          </div>
          {k.hint && <div className="text-[10px] text-muted-foreground truncate">{k.hint}</div>}
        </div>
      ))}
    </div>
  );
}
