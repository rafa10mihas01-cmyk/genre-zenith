/* eslint-disable react-refresh/only-export-components -- co-located helpers/variants/hooks; split would force a large refactor with no runtime benefit (HMR only) */
// FluxoCriticalAlerts — banner de alertas críticos extraído dos nós do pipeline.
// Mostra no topo apenas quando há `level: error` ou warnings de alta prioridade.
// Clicar no alerta foca a etapa correspondente (callback opcional).
import { AlertTriangle, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FluxoNodeData } from "./types";

export type CriticalAlert = {
  nodeId: string;
  nodeLabel: string;
  level: "error" | "warning";
  message: string;
  hint?: string;
};

export function extractCriticalAlerts(nodes: FluxoNodeData[]): CriticalAlert[] {
  const out: CriticalAlert[] = [];
  for (const n of nodes) {
    for (const a of n.details.alerts ?? []) {
      if (a.level === "error" || a.level === "warning") {
        out.push({
          nodeId: n.id,
          nodeLabel: n.label,
          level: a.level,
          message: a.message,
          hint: a.hint,
        });
      }
    }
    // Heurísticas extras: aproveitamento zero / capacidade cheia
    if (n.id === "execucao" && n.outputCount === 0 && n.status !== "idle") {
      out.push({
        nodeId: n.id,
        nodeLabel: n.label,
        level: "error",
        message: "Nenhum job concluído nesta janela.",
        hint: "Verifique worker, contas Spotify e fila de execução.",
      });
    }
  }
  // Dedup por (nodeId + message)
  const seen = new Set<string>();
  return out.filter((a) => {
    const k = `${a.nodeId}:${a.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function FluxoCriticalAlerts({
  alerts,
  onFocusNode,
  onDismissAll,
}: {
  alerts: CriticalAlert[];
  onFocusNode?: (nodeId: string) => void;
  onDismissAll?: () => void;
}) {
  if (alerts.length === 0) return null;

  const errors = alerts.filter((a) => a.level === "error");
  const warnings = alerts.filter((a) => a.level === "warning");
  const hasError = errors.length > 0;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border-2 p-3 sm:p-4 animate-fade-in",
        hasError
          ? "border-destructive/60 bg-destructive/[0.06] fluxo-error-glow"
          : "border-warning/50 bg-warning/[0.05]",
      )}
      role="alert"
    >
      {/* Halo */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full blur-3xl opacity-25",
          hasError ? "bg-destructive" : "bg-warning",
        )}
      />

      <div className="relative flex items-start gap-3">
        <div
          className={cn(
            "h-9 w-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
            hasError ? "bg-destructive/15" : "bg-warning/15",
          )}
        >
          {hasError ? (
            <AlertCircle className={cn("h-5 w-5 text-destructive", "fluxo-live-dot")} />
          ) : (
            <AlertTriangle className="h-5 w-5 text-warning" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p
              className={cn(
                "text-[10px] uppercase tracking-widest font-bold",
                hasError ? "text-destructive" : "text-warning",
              )}
            >
              {hasError ? "Problemas críticos detectados" : "Alertas no pipeline"}
            </p>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {errors.length > 0 && `${errors.length} erro${errors.length > 1 ? "s" : ""}`}
              {errors.length > 0 && warnings.length > 0 && " · "}
              {warnings.length > 0 && `${warnings.length} aviso${warnings.length > 1 ? "s" : ""}`}
            </span>
          </div>

          <ul className="mt-2 space-y-1.5">
            {alerts.slice(0, 4).map((a, i) => (
              <li key={`${a.nodeId}-${i}`}>
                <button
                  type="button"
                  onClick={() => onFocusNode?.(a.nodeId)}
                  className={cn(
                    "group w-full text-left flex items-start gap-2 rounded-lg px-2 py-1.5 -mx-2",
                    "hover:bg-background/40 transition-colors",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1 h-1.5 w-1.5 rounded-full shrink-0",
                      a.level === "error" ? "bg-destructive" : "bg-warning",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                        {a.nodeLabel}
                      </span>
                      <span className="text-sm text-foreground leading-snug">
                        {a.message}
                      </span>
                    </span>
                    {a.hint && (
                      <span className="block text-[11px] text-muted-foreground mt-0.5">
                        💡 {a.hint}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity shrink-0 self-center">
                    ver →
                  </span>
                </button>
              </li>
            ))}
            {alerts.length > 4 && (
              <li className="text-[11px] text-muted-foreground pl-3.5">
                + {alerts.length - 4} outro{alerts.length - 4 > 1 ? "s" : ""} alerta{alerts.length - 4 > 1 ? "s" : ""}
              </li>
            )}
          </ul>
        </div>

        {onDismissAll && (
          <button
            type="button"
            onClick={onDismissAll}
            className="shrink-0 h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background/40 transition-colors"
            aria-label="Fechar alertas"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}