import { cn } from "@/lib/utils";

export type StatusVariant = "success" | "warning" | "danger" | "neutral" | "primary";

const variantClasses: Record<StatusVariant, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  neutral: "bg-muted-foreground/60",
  primary: "bg-primary",
};

const labelClasses: Record<StatusVariant, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
  primary: "text-primary",
};

export interface StatusDotProps {
  variant?: StatusVariant;
  label?: string;
  pulse?: boolean;
  className?: string;
  /** Mostra a label em tom muted (cinza) em vez da cor do variant. */
  mutedLabel?: boolean;
  title?: string;
}

/**
 * Indicador minimalista de status: bola colorida + label opcional.
 * Substitui pills/badges coloridos espalhados pela UI.
 */
export function StatusDot({
  variant = "neutral",
  label,
  pulse = false,
  className,
  mutedLabel = false,
  title,
}: StatusDotProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[11.5px] font-medium", className)}
      title={title ?? label}
    >
      <span className="relative inline-flex h-2 w-2 shrink-0">
        {pulse && (
          <span
            className={cn(
              "absolute inset-0 rounded-full opacity-60 animate-ping",
              variantClasses[variant],
            )}
          />
        )}
        <span className={cn("relative inline-block h-2 w-2 rounded-full", variantClasses[variant])} />
      </span>
      {label && (
        <span className={cn("truncate", mutedLabel ? "text-muted-foreground" : labelClasses[variant])}>
          {label}
        </span>
      )}
    </span>
  );
}
