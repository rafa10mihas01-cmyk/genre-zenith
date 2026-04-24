// FluxoNode — bloco visual de uma etapa do pipeline.
// Estados: idle (apagado), running (glow pulsante), success (glow leve), error (glow vermelho), warning.
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FluxoNodeData } from "./types";

const STATUS_STYLES = {
  idle: {
    border: "border-border",
    bg: "bg-card/60",
    iconBg: "bg-elevated",
    iconColor: "text-muted-foreground",
    glow: "",
    badge: "text-muted-foreground border-border bg-card",
    valueColor: "text-foreground/80",
  },
  running: {
    border: "border-warning/70",
    bg: "bg-warning/[0.04]",
    iconBg: "bg-warning/15",
    iconColor: "text-warning",
    glow: "fluxo-active-glow",
    badge: "text-warning border-warning/40 bg-warning/10",
    valueColor: "text-warning",
  },
  success: {
    border: "border-success/45",
    bg: "bg-card",
    iconBg: "bg-success/15",
    iconColor: "text-success",
    glow: "fluxo-success-glow",
    badge: "text-success border-success/40 bg-success/10",
    valueColor: "text-foreground",
  },
  error: {
    border: "border-destructive/70",
    bg: "bg-destructive/[0.04]",
    iconBg: "bg-destructive/15",
    iconColor: "text-destructive",
    glow: "fluxo-error-glow",
    badge: "text-destructive border-destructive/40 bg-destructive/10",
    valueColor: "text-destructive",
  },
  warning: {
    border: "border-warning/45",
    bg: "bg-card",
    iconBg: "bg-warning/15",
    iconColor: "text-warning",
    glow: "",
    badge: "text-warning border-warning/40 bg-warning/10",
    valueColor: "text-warning",
  },
} as const;

function fmtTime(ms: number | null | undefined): string | null {
  if (ms == null || ms <= 0) return null;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}m${Math.floor(s % 60).toString().padStart(2, "0")}s`;
}

function StatusIcon({ status }: { status: FluxoNodeData["status"] }) {
  if (status === "running") return <Loader2 className="h-3 w-3 animate-spin" />;
  if (status === "error") return <AlertTriangle className="h-3 w-3" />;
  if (status === "success") return <CheckCircle2 className="h-3 w-3" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />;
}

const STATUS_LABEL: Record<FluxoNodeData["status"], string> = {
  idle: "aguardando",
  running: "rodando",
  success: "ok",
  error: "erro",
  warning: "atenção",
};

export function FluxoNode({
  node,
  onClick,
  selected,
}: {
  node: FluxoNodeData;
  onClick: () => void;
  selected?: boolean;
}) {
  const s = STATUS_STYLES[node.status];
  const Icon = node.icon;
  const time = fmtTime(node.durationMs);
  const showCounters = node.inputCount != null || node.outputCount != null;
  const isRunning = node.status === "running";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "fluxo-node-hover group relative w-full text-left rounded-2xl border-2",
        "p-3.5 sm:p-4 active:scale-[0.99]",
        s.border, s.bg, s.glow,
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        isRunning && "scale-[1.02]",
      )}
    >
      {/* Indicador "AO VIVO" no canto quando running */}
      {isRunning && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning text-[8px] font-bold uppercase tracking-widest text-background shadow-lg z-10">
          <span className="fluxo-live-dot h-1.5 w-1.5 rounded-full bg-background" />
          ao vivo
        </span>
      )}

      {/* Header: ícone + status badge */}
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className={cn(
          "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-transform",
          s.iconBg,
          isRunning && "animate-pulse-soft",
        )}>
          <Icon className={cn("h-5 w-5", s.iconColor)} />
        </div>
        <span className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9px] uppercase tracking-wider font-bold",
          s.badge,
        )}>
          <StatusIcon status={node.status} />
          {STATUS_LABEL[node.status]}
        </span>
      </div>

      {/* Nome */}
      <div className="mb-1.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold leading-none mb-0.5">
          {node.shortLabel}
        </p>
        <p className="text-sm font-bold text-foreground leading-tight">{node.label}</p>
      </div>

      {/* Contadores in → out */}
      {showCounters && (
        <div className="flex items-baseline gap-1.5 mb-1.5 tabular-nums">
          {node.inputCount != null && (
            <span className="text-xs text-muted-foreground">{node.inputCount}</span>
          )}
          {node.inputCount != null && node.outputCount != null && (
            <span className="text-muted-foreground/60 text-xs">→</span>
          )}
          {node.outputCount != null && (
            <span className={cn("text-base font-bold leading-none", s.valueColor)}>
              {node.outputCount}
            </span>
          )}
        </div>
      )}

      {/* Descrição + tempo */}
      <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
        <span className="truncate">{node.description ?? "—"}</span>
        {time && <span className="tabular-nums shrink-0">{time}</span>}
      </div>

      {/* Hint clique */}
      <div className="absolute bottom-1.5 right-2.5 text-[8px] text-muted-foreground/40 uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
        ver detalhes →
      </div>
    </button>
  );
}
