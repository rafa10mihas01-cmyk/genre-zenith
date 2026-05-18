import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewMode = "card" | "list";

interface Props {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
  className?: string;
}

/** Alternância visual entre grade de cards e lista. Padrão único da plataforma. */
export function ViewModeToggle({ value, onChange, className }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Modo de visualização"
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-card p-0.5 h-9",
        className,
      )}
    >
      {([
        { id: "card" as const, icon: LayoutGrid, label: "Cards" },
        { id: "list" as const, icon: List, label: "Lista" },
      ]).map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              "h-8 px-3 inline-flex items-center gap-1.5 rounded-full text-xs font-medium transition-colors",
              active
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
