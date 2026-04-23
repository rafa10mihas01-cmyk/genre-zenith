import { cn } from "@/lib/utils";
import { ReactNode } from "react";

/**
 * KpiBig — KPI GRANDE padrão (Cérebro / Home / Operação / Criação / Performance).
 *
 * Toda página DEVE usar este componente para os cards de métrica do topo.
 * Não criar variantes locais (KpiBox, KpiCard, etc).
 *
 * Layout: card largo, label uppercase pequeno + ícone discreto à direita,
 * valor enorme (text-2xl bold), hint opcional embaixo.
 */
export interface KpiBigProps {
  label: string;
  value: string | number;
  icon?: any;
  hint?: string;
  tone?: "default" | "primary" | "destructive" | "warning" | "success";
  className?: string;
  action?: ReactNode;
}

const TONE_CLS: Record<NonNullable<KpiBigProps["tone"]>, string> = {
  default:     "text-foreground",
  primary:     "text-primary",
  destructive: "text-destructive",
  warning:     "text-warning",
  success:     "text-success",
};

export function KpiBig({
  label,
  value,
  icon: Icon,
  hint,
  tone = "default",
  className,
  action,
}: KpiBigProps) {
  return (
    <div className={cn("nx-card p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-medium">
          {label}
        </span>
        {action ?? (Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />)}
      </div>
      <div className={cn("text-2xl font-bold mt-1.5 tabular-nums leading-tight", TONE_CLS[tone])}>
        {value}
      </div>
      {hint && (
        <div className="text-[11px] text-muted-foreground mt-1 truncate">{hint}</div>
      )}
    </div>
  );
}
