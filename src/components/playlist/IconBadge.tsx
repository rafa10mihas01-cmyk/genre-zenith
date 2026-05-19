import { forwardRef, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Tone = "primary" | "warning" | "destructive" | "muted" | "neutral";

const TONE_CLS: Record<Tone, string> = {
  primary: "bg-primary/15 border-primary/40 text-primary hover:bg-primary/25",
  warning: "bg-warning/20 border-warning/50 text-warning hover:bg-warning/30",
  destructive: "bg-destructive/15 border-destructive/40 text-destructive hover:bg-destructive/25",
  muted: "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50",
  neutral: "bg-elevated border-border text-foreground hover:bg-[hsl(var(--hover))]",
};

interface IconBadgeProps {
  /** Título curto exibido em destaque no tooltip */
  title: string;
  /** Descrição completa em português */
  description: ReactNode;
  /** Ícone (componente Lucide) — opcional quando label é usado */
  icon?: React.ComponentType<{ className?: string }>;
  /** Label de texto curto (ex: "V46") quando não há ícone adequado */
  label?: string;
  tone?: Tone;
  /** Quando true, ícone fica preenchido */
  filled?: boolean;
  className?: string;
  /** Para casos interativos (popovers) — renderiza como botão */
  as?: "span" | "button";
  onClick?: (e: React.MouseEvent) => void;
  ariaLabel?: string;
}

export const IconBadge = forwardRef<HTMLElement, IconBadgeProps>(function IconBadge(
  { title, description, icon: Icon, label, tone = "neutral", filled, className, as = "span", onClick, ariaLabel },
  ref,
) {
  const Comp = as as any;
  const base = cn(
    "inline-flex items-center justify-center rounded-full border transition-colors shrink-0 w-[18px] h-[18px]",
    TONE_CLS[tone],
    className,
  );
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <Comp
          ref={ref as any}
          type={as === "button" ? "button" : undefined}
          onClick={onClick}
          aria-label={ariaLabel ?? title}
          className={base}
        >
          {Icon ? (
            <Icon
              className={cn("h-2.5 w-2.5")}
              {...(filled ? { fill: "currentColor" } : {})}
            />
          ) : (
            <span className="text-[9px] font-bold leading-none tabular-nums">{label}</span>
          )}
        </Comp>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" className="max-w-[260px]">
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-foreground">{title}</div>
          <div className="text-[11px] text-muted-foreground leading-relaxed">{description}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
});
