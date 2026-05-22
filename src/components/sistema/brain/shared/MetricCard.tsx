// MetricCard — valor grande + delta + sparkline.
import { ResponsiveContainer, LineChart, Line } from "recharts";
import { TrendBadge } from "./TrendBadge";
import { cn } from "@/lib/utils";

export function MetricCard({
  label, value, hint, series, delta, accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  series?: Array<{ t: string; v: number }>;
  delta?: number | null;
  accent?: "default" | "growth" | "decay" | "neutral" | "drift";
}) {
  const stroke =
    accent === "growth" ? "hsl(var(--primary))" :
    accent === "decay" ? "hsl(var(--destructive))" :
    accent === "drift" ? "hsl(258 60% 70%)" :
    "hsl(var(--muted-foreground))";
  return (
    <div className="nx-card p-4 flex flex-col gap-2 min-h-[120px]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        {delta !== undefined && <TrendBadge delta={delta ?? null} />}
      </div>
      <div className="flex items-end justify-between gap-3">
        <p className={cn("text-2xl font-semibold leading-none")}>{value}</p>
        {series && series.length > 1 && (
          <div className="h-9 w-24 opacity-90">
            <ResponsiveContainer>
              <LineChart data={series}>
                <Line type="monotone" dataKey="v" stroke={stroke} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
