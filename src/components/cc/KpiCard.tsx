import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

type GlowTone = "indigo" | "violet" | "blue" | "emerald" | "amber" | "rose";

const TONE_RGB: Record<GlowTone, string> = {
  indigo: "99,102,241",
  violet: "168,85,247",
  blue: "59,130,246",
  emerald: "52,211,153",
  amber: "251,191,36",
  rose: "244,63,94",
};

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: GlowTone;
  className?: string;
}

/**
 * KpiCard — NexCreatorX V3 mini-card de métrica
 * cc-glass + hover lift + glow colorido por tipo + ícone em quadradinho
 */
export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "indigo",
  className,
}: KpiCardProps) {
  const rgb = TONE_RGB[tone];
  return (
    <div
      className={cn(
        "cc-glass cc-glass-hover relative overflow-hidden p-5",
        className
      )}
    >
      {/* halo radial sutil canto superior direito */}
      <div
        className="absolute -top-12 -right-12 h-32 w-32 rounded-full pointer-events-none opacity-60"
        style={{
          background: `radial-gradient(circle, rgba(${rgb},0.18) 0%, transparent 70%)`,
          filter: "blur(20px)",
        }}
        aria-hidden
      />

      <div className="relative flex items-start justify-between gap-3">
        <span className="typo-label">{label}</span>
        {Icon && (
          <div
            className="h-7 w-7 rounded-md flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, rgba(${rgb},0.20), rgba(${rgb},0.08))`,
              border: `1px solid rgba(${rgb},0.30)`,
            }}
          >
            <Icon className="h-3.5 w-3.5" style={{ color: `rgba(${rgb},1)` }} />
          </div>
        )}
      </div>

      <div className="relative mt-3 typo-kpi text-foreground">{value}</div>

      {hint && (
        <div className="relative mt-1.5 typo-tertiary truncate">{hint}</div>
      )}
    </div>
  );
}
