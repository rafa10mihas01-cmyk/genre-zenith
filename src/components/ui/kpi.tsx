import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * <Kpi /> — componente ÚNICO de KPI do app.
 *
 * Regras de tipografia (não burlar localmente):
 *  - label  → `uppercase tracking-wider text-[10px] text-muted-foreground`
 *  - valor  → `text-3xl font-semibold` (default), `text-4xl` (hero), `text-xl` (compact)
 *  - vazio  → "Sem dados" em `text-sm text-muted-foreground` (não ocupa o slot grande)
 *
 * Substitui: KpiBig, FinKpi e os <Kpi> ad-hoc espalhados por cada tela.
 */

export type KpiDomain =
  | "clients" | "curators" | "campaigns" | "deals"
  | "community" | "playlists" | "system";

export type KpiVariant = "hero" | "default" | "compact";
export type KpiTone = "default" | "primary" | "destructive" | "warning" | "success";

export interface KpiProps {
  label: string;
  value: ReactNode | number | null | undefined;
  /** Hint discreto abaixo do valor. */
  hint?: ReactNode;
  icon?: any;
  /** Cor de domínio aplicada no ícone (acento pequeno). Não afeta o valor. */
  domain?: KpiDomain;
  tone?: KpiTone;
  variant?: KpiVariant;
  className?: string;
  action?: ReactNode;
  loading?: boolean;
  /** Força o estado "Sem dados" mesmo com valor preenchido. */
  empty?: boolean;
  /** Texto do estado vazio (default: "Sem dados"). */
  emptyLabel?: string;
}

const TONE_CLS: Record<KpiTone, string> = {
  default:     "text-foreground",
  primary:     "text-primary",
  destructive: "text-destructive",
  warning:     "text-warning",
  success:     "text-success",
};

const VALUE_SIZE: Record<KpiVariant, string> = {
  hero:    "text-4xl font-semibold tracking-tight",
  default: "text-3xl font-semibold",
  compact: "text-xl font-semibold",
};

const PADDING: Record<KpiVariant, string> = {
  hero:    "p-5 min-h-[132px]",
  default: "p-4 min-h-[112px]",
  compact: "p-3 min-h-[88px]",
};

/** Considera "vazio": null, undefined, 0, "0", "0%", string sem dígitos não-zero, "—". */
function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "number") return v === 0 || !Number.isFinite(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (!s || s === "—" || s === "-") return true;
    const digits = s.replace(/[^\d]/g, "");
    if (!digits) return false;
    return Number(digits) === 0;
  }
  return false;
}

export function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  domain,
  tone = "default",
  variant = "default",
  className,
  action,
  loading = false,
  empty,
  emptyLabel = "Sem dados",
}: KpiProps) {
  const isHero = variant === "hero";
  const iconStyle = domain
    ? ({ color: `hsl(var(--domain-${domain}))` } as React.CSSProperties)
    : undefined;

  const showEmpty = !loading && (empty ?? isEmptyValue(value));

  return (
    <div
      className={cn(
        "relative overflow-hidden flex flex-col gap-2 rounded-2xl border transition-colors",
        PADDING[variant],
        isHero
          ? "border-border border-l-2 border-l-primary bg-gradient-to-br from-card via-card to-primary/[0.06]"
          : "border-border bg-card",
        className,
      )}
    >
      {isHero && (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-primary/15 blur-3xl"
        />
      )}

      {/* Header — label + ícone/ação */}
      <div className="relative flex items-start justify-between gap-2 min-h-4">
        <span className="uppercase tracking-wider text-[10px] text-muted-foreground font-medium leading-tight line-clamp-2 break-words">
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

      {/* Valor */}
      <div
        className={cn(
          "relative flex-1 flex items-center min-w-0",
          TONE_CLS[tone],
        )}
      >
        {loading ? (
          <Skeleton className="h-7 w-24 rounded-md bg-muted/80" />
        ) : showEmpty ? (
          <span className="text-sm font-medium text-muted-foreground leading-none">
            {emptyLabel}
          </span>
        ) : (
          <span
            className={cn(
              "tabular-nums leading-tight truncate max-w-full block",
              VALUE_SIZE[variant],
            )}
          >
            {value as ReactNode}
          </span>
        )}
      </div>

      {/* Hint */}
      <div className="relative h-[14px] flex items-center">
        {loading ? (
          <Skeleton className="h-3 w-32 rounded-md bg-muted/70" />
        ) : hint ? (
          <span className="truncate leading-none text-[11px] text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}
