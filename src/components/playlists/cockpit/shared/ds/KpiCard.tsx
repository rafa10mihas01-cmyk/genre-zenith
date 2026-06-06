// KpiCard — Card M padronizado para a KPI strip (Fase 7D / D1).
// value + label + hint opcional + tone semântico.
import { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type KpiTone = "default" | "primary" | "warning" | "destructive" | "muted";

const TONE: Record<KpiTone, string> = {
  default: "text-foreground",
  primary: "text-primary",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: KpiTone;
}) {
  return (
    <Card className="p-4 min-h-[96px] flex flex-col justify-between gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">
          {label}
        </span>
        {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
      </div>
      <div className={cn("text-2xl font-semibold tabular-nums leading-none", TONE[tone])}>
        {value}
      </div>
      {hint && (
        <div className="text-[11px] text-muted-foreground leading-snug truncate">
          {hint}
        </div>
      )}
    </Card>
  );
}
