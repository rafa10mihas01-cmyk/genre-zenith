import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp } from "lucide-react";

export interface MetricCellProps {
  label: string;
  value: React.ReactNode;
  /** Sufixo discreto após o número (ex: "/dia", "%"). */
  suffix?: React.ReactNode;
  /** Delta opcional. Positivo = verde, negativo = vermelho. */
  delta?: number | null;
  deltaSuffix?: string;
  className?: string;
  align?: "left" | "right";
  size?: "sm" | "md" | "lg";
}

/**
 * Célula tabular de métrica — usada em listas compactas (DealRow) e
 * resumos executivos. Tipografia consistente, sem cor de fundo.
 */
export function MetricCell({
  label,
  value,
  suffix,
  delta,
  deltaSuffix = "%",
  className,
  align = "left",
  size = "md",
}: MetricCellProps) {
  const sizes = {
    sm: { value: "text-[13px]", label: "text-[10px]" },
    md: { value: "text-[15px]", label: "text-[10px]" },
    lg: { value: "text-[22px]", label: "text-[11px]" },
  }[size];

  return (
    <div
      className={cn(
        "flex flex-col min-w-0",
        align === "right" ? "items-end text-right" : "items-start text-left",
        className,
      )}
    >
      <span
        className={cn(
          "uppercase tracking-[0.12em] text-muted-foreground font-medium leading-none",
          sizes.label,
        )}
      >
        {label}
      </span>
      <div className="flex items-baseline gap-1 mt-1 min-w-0">
        <span className={cn("font-semibold tabular-nums text-foreground leading-none", sizes.value)}>
          {value}
        </span>
        {suffix && (
          <span className="text-[10.5px] text-muted-foreground leading-none">{suffix}</span>
        )}
        {typeof delta === "number" && Number.isFinite(delta) && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[10.5px] font-medium tabular-nums leading-none",
              delta >= 0 ? "text-success" : "text-destructive",
            )}
          >
            {delta >= 0 ? (
              <TrendingUp className="h-2.5 w-2.5" />
            ) : (
              <TrendingDown className="h-2.5 w-2.5" />
            )}
            {Math.abs(delta).toFixed(0)}
            {deltaSuffix}
          </span>
        )}
      </div>
    </div>
  );
}
