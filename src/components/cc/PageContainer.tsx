import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageContainerProps {
  children: ReactNode;
  className?: string;
  /** max-w preset (default 6xl) */
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "4xl" | "5xl" | "6xl" | "7xl" | "full";
}

const SIZE_MAP: Record<NonNullable<PageContainerProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-7xl",
  full: "max-w-full",
};

/**
 * PageContainer — wrapper padrão de páginas NexCreatorX
 * - paddings horizontais responsivos
 * - clearance inferior pro mobile bottom nav (pb-20 md:pb-8)
 * - largura máxima centralizada
 */
export function PageContainer({ children, className, size = "6xl" }: PageContainerProps) {
  return (
    <div className={cn("mx-auto w-full px-4 sm:px-6 pb-20 md:pb-8", SIZE_MAP[size], className)}>
      {children}
    </div>
  );
}
