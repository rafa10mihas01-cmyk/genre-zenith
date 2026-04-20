import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** small uppercase eyebrow above the title */
  eyebrow?: ReactNode;
  /** main title (will be rendered with display font) */
  title: ReactNode;
  /** optional accented portion appended to the title with gradient */
  titleAccent?: ReactNode;
  /** subtitle (muted) */
  subtitle?: ReactNode;
  /** right-aligned actions (buttons, badges, etc.) */
  actions?: ReactNode;
  className?: string;
}

/**
 * PageHeader — NexCreatorX V3 cabeçalho de página
 * Título grande com gradient accent + orb ambiente + animação fade/translate
 */
export function PageHeader({
  eyebrow,
  title,
  titleAccent,
  subtitle,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("relative cc-anim-enter", className)}>
      {/* Orb ambiente atrás do título */}
      <div
        className="cc-orb cc-orb-indigo absolute"
        style={{
          top: "-120px",
          right: "10%",
          height: "360px",
          width: "360px",
          opacity: 0.35,
        }}
        aria-hidden
      />

      <div className="relative flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0 max-w-2xl">
          {eyebrow && <div className="typo-label mb-1.5">{eyebrow}</div>}
          <h1
            className="font-display text-2xl md:text-3xl font-semibold leading-tight tracking-tight text-foreground"
            style={{ filter: "drop-shadow(0 2px 24px rgba(99,102,241,0.20))" }}
          >
            {title}
            {titleAccent && (
              <>
                {" "}
                <span className="cc-title-accent">{titleAccent}</span>
              </>
            )}
          </h1>
          {subtitle && <p className="typo-page-subtitle mt-3 max-w-xl">{subtitle}</p>}
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>
        )}
      </div>
    </div>
  );
}
