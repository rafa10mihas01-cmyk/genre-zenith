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
    <div
      className={cn(
        // Card com altura fixa garantida + estrutura em 3 zonas verticais.
        // gap-2 (8px) entre cada zona = ritmo idêntico em todos os cards.
        "nx-card p-4 h-[120px] flex flex-col gap-2",
        className,
      )}
    >
      {/* ZONA 1 — HEADER: label à esquerda, ícone à direita.
          Altura fixa de 16px e items-center garante baseline idêntico
          mesmo quando o card não tem ícone. */}
      <div className="h-4 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-medium leading-none">
          {label}
        </span>
        <div className="h-4 w-4 flex items-center justify-center shrink-0">
          {action ?? (Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />)}
        </div>
      </div>

      {/* ZONA 2 — VALOR: ocupa o espaço flexível, sempre centralizado
          verticalmente. Tabular-nums alinha dígitos perfeitamente entre cards. */}
      <div className={cn("flex-1 flex items-center", TONE_CLS[tone])}>
        {loading ? (
          <Skeleton className="h-7 w-24 rounded-md bg-muted/80" />
        ) : isEmptyValue(value) ? (
          <span className="text-sm font-medium text-muted-foreground leading-none">
            Sem dados ainda
          </span>
        ) : (
          <span className="text-2xl font-bold tabular-nums leading-none">
            {value}
          </span>
        )}
      </div>

      {/* ZONA 3 — HINT: altura fixa de 14px reservada SEMPRE (mesmo sem hint),
          para garantir que valor fique no mesmo Y em todos os cards. */}
      <div className="h-[14px] flex items-center">
        {loading ? (
          <Skeleton className="h-3 w-32 rounded-md bg-muted/70" />
        ) : hint ? (
          <span className="text-[11px] text-muted-foreground truncate leading-none">
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}
