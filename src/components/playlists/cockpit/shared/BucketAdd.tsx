import { Button } from "@/components/ui/button";
import { Loader2, Plus } from "lucide-react";
import type { Suggestion, Zone } from "../types";
import { BucketShell } from "./BucketShell";
import { NewTrackTarget } from "./NewTrackTarget";
import { TrackExplain } from "./TrackExplain";
import { explainSuggestion } from "./trackExplain";

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
        const ex = explainSuggestion(t);
        return (
          <div
            key={t.spotify_track_id}
            data-add-track-id={t.spotify_track_id}
            className="flex items-start gap-3 px-4 py-2.5 hover:bg-elevated/40 transition-colors rounded"
          >
            <div className="pt-0.5">
              <NewTrackTarget zone={t._zone} pos={t.suggested_position} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{t.nome || "—"}</div>
              <div className="text-xs text-muted-foreground truncate">{t.artista || "—"}</div>
              <TrackExplain data={ex} />
            </div>
            <div className="shrink-0 pt-0.5">
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
