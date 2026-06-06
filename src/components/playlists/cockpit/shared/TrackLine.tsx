import React from "react";
import { PositionBadge } from "./PositionBadge";

export function TrackLine({
  position, target, title, artist, reason, action,
}: { position: number; target: number | null; title: string; artist: string; reason: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 hover:bg-elevated/40 transition-colors">
      <PositionBadge from={position} to={target} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{title}</div>
        <div className="text-[11px] text-muted-foreground truncate">{artist} · {reason}</div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
