import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface HeroCardProps {
  children: ReactNode;
  className?: string;
  /** disable both ambient orbs */
  noOrbs?: boolean;
}

/**
 * HeroCard — NexCreatorX V3 card grande / destaque
 * cc-glass + 2 orbs ambientes (TR indigo + BL violet) + animação de entrada
 */
export function HeroCard({ children, className, noOrbs }: HeroCardProps) {
  return (
    <div
      className={cn(
        "cc-glass relative overflow-hidden p-6 md:p-8 cc-anim-enter",
        className
      )}
    >
      {!noOrbs && (
        <>
          <div
            className="cc-orb cc-orb-indigo"
            style={{ top: "-160px", right: "-160px", height: "420px", width: "420px" }}
            aria-hidden
          />
          <div
            className="cc-orb cc-orb-violet"
            style={{ bottom: "-120px", left: "-120px", height: "300px", width: "300px", opacity: 0.45 }}
            aria-hidden
          />
        </>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}
