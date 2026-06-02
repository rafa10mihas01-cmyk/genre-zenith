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

export function KpiBig({ tier = "default", className, ...props }: KpiBigProps) {
  // tier foi descontinuado visualmente — todos os KPIs renderizam uniformes (igual /deals).
  // Mantemos a prop por compat, mas não aplicamos mais col-span/opacity/variant especial.
  const composed = [className].filter(Boolean).join(" ");
  return (
    <Kpi
      {...props}
      variant="default"
      tone={props.tone ?? "default"}
      className={composed || undefined}
    />
  );
}


