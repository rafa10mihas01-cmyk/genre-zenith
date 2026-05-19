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
  /**
   * Hierarquia cockpit:
   * - `hero`    → métrica âncora (col-span-2 no grid, tipografia maior, glow primary)
   * - `default` → leitura tática
   * - `quiet`   → referência/histórico (peso reduzido)
   *
   * Use no máximo UM `hero` por régua de KPIs.
   */
  tier?: "hero" | "default" | "quiet";
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
  tier = "default",
}: KpiBigProps) {
  const iconStyle = domain ? ({ color: `hsl(var(--domain-${domain}))` } as React.CSSProperties) : undefined;

  const isHero = tier === "hero";
  const isQuiet = tier === "quiet";

  return (
    <div
      className={cn(
        "relative overflow-hidden flex flex-col gap-2 p-4 min-h-[120px] rounded-2xl border transition-colors",
        // Tier styling
        isHero    && "md:col-span-2 border-border border-l-2 border-l-primary bg-card",
        isQuiet   && "border-border/60 bg-card/60",
        !isHero && !isQuiet && "nx-card",
        className,
      )}
    >
      {/* Glow sutil — só no hero */}
      {isHero && (
        <div
          className="pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full bg-primary/10 blur-2xl"
          aria-hidden
        />
      )}

      {/* ZONA 1 — HEADER */}
      <div className="relative min-h-4 flex items-start justify-between gap-2">
        <span
          className={cn(
            "uppercase font-semibold leading-tight line-clamp-2 break-words",
            isHero ? "text-[11px] tracking-[0.12em] text-primary"
                   : "text-[10px] tracking-[0.12em] text-muted-foreground font-medium",
            isQuiet && "text-muted-foreground/80",
          )}
        >
          {label}
        </span>
        <div className="h-4 w-4 flex items-center justify-center shrink-0 mt-0.5">
          {action ?? (Icon && (
            <Icon
              className={cn(
                "h-3.5 w-3.5",
                isHero ? "text-primary" : !domain && "text-muted-foreground",
              )}
              style={isHero ? undefined : iconStyle}
            />
          ))}
        </div>
      </div>

      {/* ZONA 2 — VALOR */}
      <div
        className={cn(
          "relative flex-1 flex items-center min-w-0",
          isQuiet ? "text-muted-foreground" : TONE_CLS[tone],
        )}
      >
        {loading ? (
          <Skeleton className="h-7 w-24 rounded-md bg-muted/80" />
        ) : isEmptyValue(value) ? (
          <span className="text-sm font-medium text-muted-foreground leading-none">
            Sem dados
          </span>
        ) : (
          <span
            className={cn(
              "tabular-nums leading-tight truncate max-w-full block",
              isHero  ? "text-3xl md:text-4xl font-semibold tracking-tight"
              : isQuiet ? "text-lg font-medium"
              : "text-lg sm:text-2xl font-bold",
            )}
          >
            {value}
          </span>
        )}
      </div>

      {/* ZONA 3 — HINT */}
      <div className="relative h-[14px] flex items-center">
        {loading ? (
          <Skeleton className="h-3 w-32 rounded-md bg-muted/70" />
        ) : hint ? (
          <span
            className={cn(
              "truncate leading-none",
              isQuiet ? "text-[11px] text-muted-foreground/70" : "text-[11px] text-muted-foreground",
            )}
          >
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}

