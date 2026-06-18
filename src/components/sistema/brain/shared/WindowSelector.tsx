/* eslint-disable react-refresh/only-export-components -- co-located helpers/variants/hooks; split would force a large refactor with no runtime benefit (HMR only) */
// WindowSelector — toggle 7d / 30d / 90d.
import { cn } from "@/lib/utils";

export type TimeWindow = "7d" | "30d" | "90d";

export function WindowSelector({ value, onChange }: { value: TimeWindow; onChange: (w: TimeWindow) => void }) {
  const opts: TimeWindow[] = ["7d", "30d", "90d"];
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-elevated p-0.5">
      {opts.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "px-3 py-1 text-xs font-medium rounded-sm transition-colors",
            value === o ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function windowToDays(w: TimeWindow): number {
  return w === "7d" ? 7 : w === "30d" ? 30 : 90;
}