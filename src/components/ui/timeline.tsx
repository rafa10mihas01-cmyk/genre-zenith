import { cn } from "@/lib/utils";

export interface TimelineItem {
  id: string;
  date: React.ReactNode;
  /** Conteúdo principal (uma linha). */
  primary: React.ReactNode;
  /** Conteúdo secundário (texto auxiliar à direita). */
  secondary?: React.ReactNode;
  /** Variant de cor da bolinha à esquerda. */
  tone?: "primary" | "success" | "warning" | "danger" | "neutral";
  onClick?: () => void;
}

const toneClass: Record<NonNullable<TimelineItem["tone"]>, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  neutral: "bg-muted-foreground/50",
};

/**
 * Timeline compacta — uma linha por evento.
 * Substitui cards grandes de histórico por leitura rápida.
 */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ol className={cn("relative pl-4", className)}>
      <span className="absolute left-[5px] top-1 bottom-1 w-px bg-border/60" aria-hidden />
      {items.map((it) => (
        <li
          key={it.id}
          className={cn(
            "relative grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2 text-[12.5px]",
            it.onClick && "cursor-pointer hover:bg-[hsl(var(--elevated))] -mx-2 px-2 rounded-md transition-colors",
          )}
          onClick={it.onClick}
        >
          <span
            className={cn(
              "absolute -left-[11px] top-1/2 -translate-y-1/2 h-2 w-2 rounded-full ring-2 ring-background",
              toneClass[it.tone ?? "neutral"],
            )}
            aria-hidden
          />
          <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
            {it.date}
          </span>
          <span className="text-foreground truncate">{it.primary}</span>
          {it.secondary && (
            <span className="text-[11.5px] text-muted-foreground tabular-nums whitespace-nowrap">
              {it.secondary}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
