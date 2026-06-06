import { Button } from "@/components/ui/button";
import { Loader2, ArrowUp, ArrowDown } from "lucide-react";
import type { AnalysisTrack } from "../types";
import { shortReason } from "../helpers";
import { BucketShell } from "./BucketShell";
import { TrackLine } from "./TrackLine";

export function BucketReorder({ kind, items, totalTracks, applying, onApplyAll }: {
  kind: "promote" | "demote";
  items: AnalysisTrack[];
  totalTracks: number;
  applying: boolean;
  onApplyAll: () => void;
}) {
  return (
    <BucketShell
      id={`bucket-${kind}`}
      kind={kind}
      count={items.length}
      headerRight={
        items.length > 0 && (
          <Button
            size="sm"
            onClick={onApplyAll}
            disabled={applying}
            variant={kind === "promote" ? "default" : "outline"}
            className="h-7 text-xs gap-1"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> :
              kind === "promote" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            Aplicar ({items.length})
          </Button>
        )
      }
    >
      {items.map((t) => {
        // target_position vem 0-based do diagnose; UI sempre 1-based humano.
        const target0 = t.target_position ?? (kind === "promote" ? 4 : Math.max(29, totalTracks - 11));
        return (
          <TrackLine
            key={t.spotify_track_id}
            position={t.position + 1}
            target={target0 + 1}
            title={t.track_name ?? "—"}
            artist={t.artist_name ?? "—"}
            reason={shortReason(t, kind)}
            action={
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {kind === "promote" ? "Topo" : "Baixo"}
              </span>
            }
          />
        );
      })}
    </BucketShell>
  );
}
