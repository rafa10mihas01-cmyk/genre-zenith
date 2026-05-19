// AppConnectionCard — container genérico para cada "App" integrado (Spotify, etc).
// Padroniza: cabeçalho com ícone+nome+status, descrição, ações no topo,
// e área pra contas/recursos do app embaixo.
import { ReactNode } from "react";
import { LucideIcon, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "ok" | "warn" | "off";

interface Props {
  icon: LucideIcon;
  name: string;
  description?: string;
  status: Status;
  statusLabel: string;
  actions?: ReactNode;
  children?: ReactNode;
}

const STATUS_STYLES: Record<Status, { dot: string; text: string; ring: string }> = {
  ok:   { dot: "bg-success",     text: "text-success",     ring: "border-success/30" },
  warn: { dot: "bg-warning",     text: "text-warning",     ring: "border-warning/30" },
  off:  { dot: "bg-destructive", text: "text-destructive", ring: "border-destructive/30" },
};

export function AppConnectionCard({
  icon: Icon, name, description, status, statusLabel, actions, children,
}: Props) {
  const s = STATUS_STYLES[status];
  return (
    <section className="nx-card overflow-hidden">
      {/* Header */}
      <header className="p-4 border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className={cn("h-9 w-9 rounded-lg bg-muted/40 flex items-center justify-center shrink-0 border", s.ring)}>
              <Icon className={cn("h-4 w-4", s.text)} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold truncate">{name}</h2>
                <span className={cn(
                  "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap shrink-0",
                  s.ring, s.text, "bg-background",
                )}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
                  {statusLabel}
                </span>
              </div>
              {description && (
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
              )}
            </div>
          </div>
          {actions && (
            <div className="flex items-center gap-2 sm:shrink-0 max-sm:w-full max-sm:justify-end max-sm:flex-wrap">
              {actions}
            </div>
          )}
        </div>
      </header>

      {/* Conteúdo (contas, recursos, etc) */}
      {children && <div className="p-4">{children}</div>}
    </section>
  );
}

export { CheckCircle2, AlertCircle };
