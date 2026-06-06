import type { Zone } from "../types";
import { ZONE_LABELS } from "../helpers";

export function NewTrackTarget({ zone, pos }: { zone: Zone; pos: number }) {
  return (
    <div className="flex items-center gap-1 shrink-0 w-20" title={`Nova faixa · ${ZONE_LABELS[zone]} #${pos + 1}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" aria-label="nova" />
      <span className="text-[11px] font-mono tabular-nums font-semibold text-primary truncate">
        {ZONE_LABELS[zone].slice(0, 3)}#{pos + 1}
      </span>
    </div>
  );
}
