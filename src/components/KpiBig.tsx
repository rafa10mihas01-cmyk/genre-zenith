import { Kpi, type KpiDomain, type KpiTone } from "@/components/ui/kpi";
import type { ReactNode } from "react";

/**
 * @deprecated Use <Kpi> de @/components/ui/kpi.
 * Mantido como alias compat — mapeia `tier` → `variant` do novo componente.
 *
 * tier `hero`    → variant `hero`
 * tier `default` → variant `default`
 * tier `quiet`   → variant `default` + tone reduzido
 */
export type { KpiDomain };

export interface KpiBigProps {
  label: string;
  value: string | number | ReactNode;
  icon?: any;
  hint?: string;
  tone?: KpiTone;
  domain?: KpiDomain;
  className?: string;
  action?: ReactNode;
  loading?: boolean;
  tier?: "hero" | "default" | "quiet";
}

export function KpiBig({ tier = "default", ...props }: KpiBigProps) {
  const variant = tier === "hero" ? "hero" : "default";
  return (
    <Kpi
      {...props}
      variant={variant}
      tone={tier === "quiet" ? "default" : (props.tone ?? "default")}
      className={tier === "quiet" ? `opacity-80 ${props.className ?? ""}` : props.className}
    />
  );
}
