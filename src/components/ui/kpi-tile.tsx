import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface KpiTileProps {
  icon?: LucideIcon;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: number | null;
  tone?: "default" | "primary" | "success" | "warning" | "danger";
  className?: string;
}

const toneRing: Record<NonNullable<KpiTileProps["tone"]>, string> = {
  default: "",
  primary: "ring-1 ring-primary/15",
  success: "ring-1 ring-success/20",
  warning: "ring-1 ring-warning/25",
  danger: "ring-1 ring-destructive/25",
};

const toneIcon: Record<NonNullable<KpiTileProps["tone"]>, string> = {
  default: "text-muted-foreground",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

/**
 * Tile grande para dashboards executivos (aba Resumo).
 * Versão minimalista do KpiBig — sem cor de fundo, tipografia maior, ring sutil.
 */
export function KpiTile({
  icon: Icon,
  label,
  value,
  hint,
  delta,
  tone = "default",
  className,
}: KpiTileProps) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-card border border-border/60 px-5 py-4 flex flex-col gap-2",
        toneRing[tone],
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
          {label}
        </span>
        {Icon && <Icon className={cn("h-4 w-4 shrink-0", toneIcon[tone])} />}
      </div>
      <div className="text-lg sm:text-[28px] font-semibold tabular-nums text-foreground leading-none tracking-tight">
        {value}
      </div>
      {(hint || typeof delta === "number") && (
        <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
          <span className="truncate">{hint}</span>
          {typeof delta === "number" && Number.isFinite(delta) && (
            <span
              className={cn(
                "font-medium tabular-nums",
                delta >= 0 ? "text-success" : "text-destructive",
              )}
            >
              {delta >= 0 ? "+" : ""}
              {delta.toFixed(0)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}
