import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

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
  loading?: boolean;
}

const TONE_CLS: Record<NonNullable<KpiBigProps["tone"]>, string> = {
  default:     "text-foreground",
  primary:     "text-primary",
  destructive: "text-destructive",
  warning:     "text-warning",
  success:     "text-success",
};

/** Detecta valores "vazios" (0, "0", "0%", "0/dia", etc) para mostrar fallback. */
function isEmptyValue(v: string | number): boolean {
  if (v === 0) return true;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return true;
    const digits = s.replace(/[^\d]/g, "");
    if (!digits) return false;
    return Number(digits) === 0;
  }
  return false;
}

export function KpiBig({
  label,
  value,
  icon: Icon,
  hint,
  tone = "default",
  className,
  action,
  loading = false,
}: KpiBigProps) {
  return (
    <div className={cn("nx-card p-4 min-h-[118px] flex flex-col", className)}>
      <div className="flex items-center justify-between gap-2 min-h-4">
        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-medium">
          {label}
        </span>
        {action ?? (Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />)}
      </div>
      <div className={cn("mt-1.5 min-h-[36px] flex items-end", TONE_CLS[tone])}>
        {loading ? (
          <Skeleton className="h-8 w-24 rounded-md bg-muted/80" />
        ) : isEmptyValue(value) ? (
          <div className="text-sm font-medium text-muted-foreground leading-tight">
            Sem dados ainda
          </div>
        ) : (
          <div className="text-2xl font-bold tabular-nums leading-tight">{value}</div>
        )}
      </div>
      <div className="mt-1 min-h-[16px]">
        {loading ? (
          <Skeleton className="h-3.5 w-32 rounded-md bg-muted/70" />
        ) : hint ? (
          <div className="text-[11px] text-muted-foreground truncate">{hint}</div>
        ) : null}
      </div>
    </div>
  );
}
