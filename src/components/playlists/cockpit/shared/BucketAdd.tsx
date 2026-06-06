import { Button } from "@/components/ui/button";
import { Loader2, Plus } from "lucide-react";
import type { Suggestion, Zone } from "../types";
import { ZONE_LABELS, ZONE_RANGE_LABEL, roleLabel } from "../helpers";
import { BucketShell } from "./BucketShell";
import { NewTrackTarget } from "./NewTrackTarget";

export function BucketAdd({ items, applying, onApplyAll }: {
  items: Array<Suggestion & { _zone: Zone }>; applying: boolean; onApplyAll: () => void;
}) {
  return (
    <BucketShell
      id="bucket-add"
      kind="add"
      count={items.length}
      headerRight={
        items.length > 0 && (
          <Button
            size="sm"
            onClick={onApplyAll}
            disabled={applying}
            className="h-7 text-xs gap-1"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Aplicar ({items.length})
          </Button>
        )
      }
    >
      {items.map((t) => {
        const zoneLabel = ZONE_LABELS[t._zone];
        const role = roleLabel(t);
        const range = ZONE_RANGE_LABEL[t._zone];
        const rec = (t.count ?? 0) >= 2 ? `recorrência ${t.count}×` : null;
        const pop = (t.popularity != null) ? `pop ${t.popularity}` : null;
        const editorial = [`${zoneLabel} · ${role}`, range, rec, pop].filter(Boolean).join(" · ");
        return (
          <div
            key={t.spotify_track_id}
            data-add-track-id={t.spotify_track_id}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-elevated/40 transition-colors rounded"
          >
            <NewTrackTarget zone={t._zone} pos={t.suggested_position} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{t.nome || "—"}</div>
              <div
                className="text-xs text-muted-foreground truncate cursor-help"
                title="Fachada = posições 1-2 · Premium = 3-5 · Sustentação = 6-10 · Cauda = 11+"
              >
                {t.artista || "—"} · {editorial}
              </div>
            </div>
            <div className="shrink-0">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Adicionar
              </span>
            </div>
          </div>
        );
      })}

    </BucketShell>
  );
}
