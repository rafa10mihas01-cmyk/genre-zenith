import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/cc/KpiCard";

type GlowTone = "indigo" | "violet" | "blue" | "emerald" | "amber" | "rose";

export interface Kpi {
  label: string;
  value: string | number;
  hint?: string;
  /** legacy tone — mapeia para cor de glow */
  tone?: "default" | "success" | "warning" | "muted";
}

const TONE_MAP: Record<NonNullable<Kpi["tone"]>, GlowTone> = {
  default: "indigo",
  success: "emerald",
  warning: "amber",
  muted: "blue",
};

export function KpiStrip({ items, className }: { items: Kpi[]; className?: string }) {
  return (
    <div className={cn("nx-page-grid-kpis", className)}>
      {items.map((k) => (
        <KpiCard
          key={k.label}
          label={k.label}
          value={k.value}
          hint={k.hint}
          tone={TONE_MAP[k.tone ?? "default"]}
        />
      ))}
    </div>
  );
}
