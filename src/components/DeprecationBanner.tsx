// DeprecationBanner — aviso visual em telas de funcionalidades em aposentadoria (Fase 1).
import { AlertTriangle } from "lucide-react";

export function DeprecationBanner({
  title = "Funcionalidade em aposentadoria",
  message = "Este módulo está sendo desativado (Fase 1). Botões de execução foram desligados; a leitura do histórico permanece disponível.",
}: { title?: string; message?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
      <AlertTriangle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{message}</div>
      </div>
    </div>
  );
}
