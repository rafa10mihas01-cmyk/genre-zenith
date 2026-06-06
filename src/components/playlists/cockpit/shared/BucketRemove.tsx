import { Button } from "@/components/ui/button";
import { Loader2, Trash2 } from "lucide-react";
import type { AnalysisTrack } from "../types";
import { shortReason } from "../helpers";
import { BucketShell } from "./BucketShell";
import { TrackLine } from "./TrackLine";
import { TrackExplain } from "./TrackExplain";
import { explainAnalysis } from "./trackExplain";

export function BucketRemove({ items, applying, onApplyAll }: {
  items: AnalysisTrack[]; applying: boolean; onApplyAll: () => void;
}) {
  return (
    <BucketShell
      id="bucket-remove"
      kind="remove"
      count={items.length}
      headerRight={
        items.length > 0 && (
          <Button
            size="sm"
            variant="destructive"
            onClick={onApplyAll}
            disabled={applying}
            className="h-7 text-xs gap-1"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Aplicar ({items.length})
          </Button>
        )
      }
    >
      {items.map((t) => {
        const ex = explainAnalysis(t, "remove");
        return (
          <TrackLine
            key={t.spotify_track_id}
            position={t.position + 1}
            target={null}
            title={t.track_name ?? "—"}
            artist={t.artist_name ?? "—"}
            reason={shortReason(t, "remove")}
            extra={<TrackExplain data={ex} />}
            action={<span className="text-[10px] text-muted-foreground uppercase tracking-wider">Remover</span>}
          />
        );
      })}
    </BucketShell>
  );
}
