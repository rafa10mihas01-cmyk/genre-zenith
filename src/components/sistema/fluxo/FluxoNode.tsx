// FluxoNode — bloco visual de uma etapa do pipeline.
// Mostra: ícone, label, status com cor semântica, contadores in→out, tempo.
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FluxoNodeData } from "./types";

const STATUS_STYLES = {
  idle: {
    border: "border-border",
    bg: "bg-card",
    iconBg: "bg-elevated",
    iconColor: "text-muted-foreground",
    glow: "",
    badge: "text-muted-foreground border-border",
  },
  running: {
    border: "border-warning/60",
    bg: "bg-warning/5",
    iconBg: "bg-warning/15",
    iconColor: "text-warning",
    glow: "shadow-[0_0_0_1px_hsl(var(--warning)/0.5),0_0_30px_hsl(var(--warning)/0.25)] animate-pulse-soft",
    badge: "text-warning border-warning/40 bg-warning/10",
  },
  success: {
    border: "border-success/40",
    bg: "bg-card",
    iconBg: "bg-success/15",
    iconColor: "text-success",
    glow: "",
    badge: "text-success border-success/40 bg-success/10",
  },
  error: {
    border: "border-destructive/60",
    bg: "bg-destructive/5",
    iconBg: "bg-destructive/15",
    iconColor: "text-destructive",
    glow: "shadow-[0_0_0_1px_hsl(var(--destructive)/0.5),0_0_30px_hsl(var(--destructive)/0.25)]",
    badge: "text-destructive border-destructive/40 bg-destructive/10",
  },
  warning: {
    border: "border-warning/40",
    bg: "bg-card",
    iconBg: "bg-warning/15",
    iconColor: "text-warning",
    glow: "",
    badge: "text-warning border-warning/40 bg-warning/10",
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
  return <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />;
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

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative w-full text-left rounded-2xl border-2 transition-all duration-200",
        "p-3 sm:p-3.5 hover:scale-[1.02] active:scale-100",
        s.border, s.bg, s.glow,
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background scale-[1.02]",
      )}
    >
      {/* Header: ícone + status badge */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", s.iconBg)}>
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
      <div className="mb-1">
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
            <span className={cn(
              "text-base font-bold leading-none",
              node.status === "error" ? "text-destructive" : "text-foreground",
            )}>
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
      <div className="absolute bottom-1 right-2 text-[8px] text-muted-foreground/40 uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
        ver detalhes
      </div>
    </button>
  );
}
