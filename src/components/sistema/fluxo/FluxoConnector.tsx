// FluxoConnector — linha animada entre dois nós com bolinha (orb) percorrendo.
// Cor reflete estado da etapa de origem; orb só aparece quando running.
import { cn } from "@/lib/utils";
import type { NodeStatus } from "./types";

const COLOR_BY_STATUS: Record<NodeStatus, { stroke: string; bg: string; glow: string }> = {
  idle:    { stroke: "hsl(var(--border))",       bg: "hsl(var(--muted-foreground))", glow: "hsl(var(--muted-foreground) / 0.2)" },
  running: { stroke: "hsl(var(--warning))",      bg: "hsl(var(--warning))",           glow: "hsl(var(--warning) / 0.6)" },
  success: { stroke: "hsl(var(--success))",      bg: "hsl(var(--success))",           glow: "hsl(var(--success) / 0.5)" },
  error:   { stroke: "hsl(var(--destructive))",  bg: "hsl(var(--destructive))",       glow: "hsl(var(--destructive) / 0.5)" },
  warning: { stroke: "hsl(var(--warning))",      bg: "hsl(var(--warning))",           glow: "hsl(var(--warning) / 0.4)" },
};

export function FluxoConnector({
  status,
  vertical = false,
}: {
  status: NodeStatus;
  vertical?: boolean;
}) {
  const c = COLOR_BY_STATUS[status];
  const animated = status === "running";
  const dashed = status === "running" || status === "idle";

  if (vertical) {
    return (
      <div className="relative flex items-center justify-center h-8 w-full" aria-hidden>
        <svg width="2" height="100%" viewBox="0 0 2 32" preserveAspectRatio="none" className="overflow-visible">
          <line
            x1="1" y1="0" x2="1" y2="32"
            stroke={c.stroke}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={dashed ? "4 4" : "0"}
            className={animated ? "fluxo-flow-v" : ""}
            opacity={status === "idle" ? 0.4 : 1}
          />
        </svg>
        {animated && (
          <span
            className="fluxo-orb-v absolute left-1/2 h-2.5 w-2.5 rounded-full -translate-x-1/2 -translate-y-1/2"
            style={{
              background: c.bg,
              boxShadow: `0 0 12px ${c.glow}, 0 0 4px ${c.glow}`,
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-center w-full min-w-[24px] h-full py-2" aria-hidden>
      <svg width="100%" height="2" viewBox="0 0 100 2" preserveAspectRatio="none" className="overflow-visible">
        <line
          x1="0" y1="1" x2="96" y2="1"
          stroke={c.stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={dashed ? "4 4" : "0"}
          className={animated ? "fluxo-flow-h" : ""}
          opacity={status === "idle" ? 0.4 : 1}
        />
        {/* Seta no fim */}
        <polygon
          points="100,1 95,-2 95,4"
          fill={c.stroke}
          opacity={status === "idle" ? 0.5 : 1}
        />
      </svg>
      {animated && (
        <span
          className={cn(
            "fluxo-orb-h absolute top-1/2 h-2.5 w-2.5 rounded-full",
          )}
          style={{
            background: c.bg,
            boxShadow: `0 0 12px ${c.glow}, 0 0 4px ${c.glow}`,
          }}
        />
      )}
    </div>
  );
}
