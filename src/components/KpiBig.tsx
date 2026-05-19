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
export type KpiDomain =
  | "clients" | "curators" | "campaigns" | "deals"
  | "community" | "playlists" | "system";

export interface KpiBigProps {
  label: string;
  value: string | number;
  icon?: any;
  hint?: string;
  tone?: "default" | "primary" | "destructive" | "warning" | "success";
  /** Cor de domínio aplicada no ícone do header. Não afeta o valor. */
  domain?: KpiDomain;
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
  domain,
  className,
  action,
  loading = false,
}: KpiBigProps) {
  const iconStyle = domain ? ({ color: `hsl(var(--domain-${domain}))` } as React.CSSProperties) : undefined;
  return (
    <div
      className={cn(
        // Card com altura fixa garantida + estrutura em 3 zonas verticais.
        // gap-2 (8px) entre cada zona = ritmo idêntico em todos os cards.
        "nx-card p-4 min-h-[120px] flex flex-col gap-2 overflow-hidden",
        className,
      )}
    >
      {/* ZONA 1 — HEADER: label à esquerda, ícone à direita. */}
      <div className="min-h-4 flex items-start justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium leading-tight line-clamp-2 break-words">
          {label}
        </span>
        <div className="h-4 w-4 flex items-center justify-center shrink-0 mt-0.5">
          {action ?? (Icon && (
            <Icon
              className={cn("h-3.5 w-3.5", !domain && "text-muted-foreground")}
              style={iconStyle}
            />
          ))}
        </div>
      </div>

      {/* ZONA 2 — VALOR */}
      <div className={cn("flex-1 flex items-center min-w-0", TONE_CLS[tone])}>
        {loading ? (
          <Skeleton className="h-7 w-24 rounded-md bg-muted/80" />
        ) : isEmptyValue(value) ? (
          <span className="text-sm font-medium text-muted-foreground leading-none">
            Sem dados
          </span>
        ) : (
          <span className="text-lg sm:text-2xl font-bold tabular-nums leading-tight truncate max-w-full block">
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
