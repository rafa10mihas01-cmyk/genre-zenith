// TabContextBanner — banner padrão de aba (Fase 7D / D1).
// Estrutura: título (substantivo) + subtítulo (verbo/função) + linha de status + ação opcional.
// Sem lógica de dados — recebe tudo pronto.
import { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function TabContextBanner({
  title,
  subtitle,
  status,
  action,
  tone = "default",
}: {
  title: string;
  subtitle: string;
  status?: ReactNode;
  action?: ReactNode;
  tone?: "default" | "warning" | "info";
}) {
  return (
    <Card
      className={cn(
        "p-4 md:p-5",
        tone === "warning" && "border-warning/40 bg-warning/[0.03]",
        tone === "info" && "border-primary/30 bg-primary/[0.03]",
      )}
    >
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="text-base font-semibold leading-tight tracking-tight text-foreground">
            {title}
          </div>
          <div className="text-sm text-muted-foreground leading-snug">
            {subtitle}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {status && (
        <div className="mt-3 pt-3 border-t border-border/60 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          {status}
        </div>
      )}
    </Card>
  );
}
