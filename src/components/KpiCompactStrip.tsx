// Strip compacta de KPIs no padrão do Catálogo (mobile/tablet).
// Render: card com colunas divididas. Use uma ou mais linhas (rows) com até N itens.
import { cn } from "@/lib/utils";

export type KpiCompactItem = {
  label: string;
  value: React.ReactNode;
};

type Row = {
  items: KpiCompactItem[];
  cols?: 2 | 3 | 4 | 5;
};

const COL_CLASS: Record<2 | 3 | 4 | 5, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

export function KpiCompactStrip({
  rows,
  loading = false,
  className,
}: {
  rows: Row[];
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("lg:hidden", className)}>
      <div
        className={cn(
          "relative rounded-2xl overflow-hidden border border-border/80",
          "bg-gradient-to-b from-[hsl(var(--card))] to-[hsl(0_0%_9%)]",
          "shadow-[0_1px_0_0_hsl(var(--primary)/0.08)_inset,0_8px_24px_-12px_hsl(0_0%_0%/0.6)]",
          "divide-y divide-border/60",
        )}
      >
        {/* hairline verde sutil no topo — sinaliza KPI sem ser agressivo */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
        />
        {rows.map((row, ri) => {
          const cols = (row.cols ?? (row.items.length as 2 | 3 | 4 | 5)) as 2 | 3 | 4 | 5;
          return (
            <div key={ri} className={cn("grid divide-x divide-border/60", COL_CLASS[cols])}>
              {row.items.map((item, i) => (
                <div
                  key={i}
                  className="px-1.5 py-3 flex flex-col items-center justify-center gap-0.5 min-w-0"
                >
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium text-center truncate w-full">
                    {item.label}
                  </span>
                  <span className="text-base font-semibold tabular-nums text-foreground text-center truncate w-full">
                    {loading ? "—" : item.value ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

