import React from "react";

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 pt-2">
      <h2 className="text-[11px] uppercase tracking-[0.2em] font-semibold text-muted-foreground">
        {children}
      </h2>
      <div className="flex-1 h-px bg-border/60" />
    </div>
  );
}
