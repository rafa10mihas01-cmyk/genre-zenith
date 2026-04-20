import { cn } from "@/lib/utils";

const map: Record<string, { color: string; bg: string; label: string; pulse?: boolean }> = {
  pendente:   { color: "bg-neutral",     bg: "bg-neutral/15 text-neutral-foreground border-neutral/30",     label: "Pendente" },
  coletando:  { color: "bg-primary",     bg: "bg-primary/15 text-primary border-primary/30",                label: "Coletando", pulse: true },
  analisando: { color: "bg-warning",     bg: "bg-warning/15 text-warning border-warning/30",                label: "Analisando", pulse: true },
  analisado:  { color: "bg-success",     bg: "bg-success/15 text-success border-success/30",                label: "Analisado" },
  erro:       { color: "bg-destructive", bg: "bg-destructive/15 text-destructive border-destructive/30",    label: "Erro" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const m = map[status] ?? map.pendente;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-md border", m.bg, className)}>
      <span className={cn("nx-status-dot", m.color, m.pulse && "animate-pulse-soft")} />
      {m.label}
    </span>
  );
}
