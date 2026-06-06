import React from "react";
import { PositionBadge } from "./PositionBadge";

export function TrackLine({
  position, target, title, artist, reason, action, extra,
}: {
  position: number;
  target: number | null;
  title: string;
  artist: string;
  /** Mantido por retrocompat. Quando `extra` é passado, vira fallback ignorado. */
  reason: string;
  action: React.ReactNode;
  /** Linha extra abaixo do nome — usado pelo TrackExplain (7A.3). */
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 px-3 py-2.5 hover:bg-elevated/40 transition-colors">
      <div className="pt-0.5"><PositionBadge from={position} to={target} /></div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{title}</div>
        <div className="text-[11px] text-muted-foreground truncate">{artist}</div>
        {extra ?? (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">{reason}</div>
        )}
      </div>
      <div className="shrink-0 pt-0.5">{action}</div>
    </div>
  );
}
