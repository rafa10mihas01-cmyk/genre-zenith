// FluxoConnector — linha animada entre dois nós.
// Cor depende do estado da etapa de origem; partículas correm quando ativo.
import { cn } from "@/lib/utils";
import type { NodeStatus } from "./types";

const COLOR_BY_STATUS: Record<NodeStatus, string> = {
  idle: "hsl(var(--border))",
  running: "hsl(var(--warning))",
  success: "hsl(var(--success))",
  error: "hsl(var(--destructive))",
  warning: "hsl(var(--warning))",
};

/** Conector horizontal (desktop) ou vertical (mobile). */
export function FluxoConnector({
  status,
  vertical = false,
}: {
  status: NodeStatus;
  vertical?: boolean;
}) {
  const color = COLOR_BY_STATUS[status];
  const animated = status === "running";

  if (vertical) {
    return (
      <div className="flex items-center justify-center h-6 w-full" aria-hidden>
        <svg width="2" height="100%" viewBox="0 0 2 24" preserveAspectRatio="none" className="overflow-visible">
          <line
            x1="1" y1="0" x2="1" y2="24"
            stroke={color}
            strokeWidth="2"
            strokeDasharray={animated ? "4 4" : "0"}
            className={animated ? "fluxo-flow-v" : ""}
          />
        </svg>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center w-full min-w-[24px] h-full" aria-hidden>
      <svg width="100%" height="2" viewBox="0 0 100 2" preserveAspectRatio="none" className="overflow-visible">
        <line
          x1="0" y1="1" x2="100" y2="1"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={animated ? "4 4" : "0"}
          className={animated ? "fluxo-flow-h" : ""}
        />
        {/* Seta no fim */}
        <polygon points="100,1 96,-1.5 96,3.5" fill={color} />
      </svg>
    </div>
  );
}
