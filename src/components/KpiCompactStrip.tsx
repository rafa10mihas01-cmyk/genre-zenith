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
      <div className="bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border">
        {rows.map((row, ri) => {
          const cols = (row.cols ?? (row.items.length as 2 | 3 | 4 | 5)) as 2 | 3 | 4 | 5;
          return (
            <div key={ri} className={cn("grid divide-x divide-border", COL_CLASS[cols])}>
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
