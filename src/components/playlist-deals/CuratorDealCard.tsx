// Placeholder — substituído pelo design definitivo no próximo prompt.
import type { CuratorDeal, CuratorDealLog, CuratorPlaylist } from "@/lib/curatorDealsUtils";
import { computeCuratorStats } from "@/lib/curatorDealsUtils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Camera, History, Trash2 } from "lucide-react";

export interface CuratorDealCardProps {
  deal: CuratorDeal;
  logs: CuratorDealLog[];
  playlists: CuratorPlaylist[];
  onLog: (deal: CuratorDeal) => void;
  onDetail: (deal: CuratorDeal) => void;
  onDelete: (deal: CuratorDeal) => void;
}

function formatPlays(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}

export function CuratorDealCard({
  deal, logs, playlists, onLog, onDetail, onDelete,
}: CuratorDealCardProps) {
  const { earned, pct } = computeCuratorStats(deal, logs, playlists);
  return (
    <Card className="overflow-hidden hover:border-foreground/25 transition-colors">
      <CardContent className="p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3 min-w-0">
          {deal.song_cover_url ? (
            <img
              src={deal.song_cover_url}
              alt={deal.song_name}
              className="h-12 w-12 rounded-md object-cover shrink-0"
            />
          ) : (
            <div className="h-12 w-12 rounded-md bg-muted shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground truncate">{deal.song_name}</div>
            <div className="text-sm text-muted-foreground truncate">
              {deal.song_artist || deal.curator_name}
            </div>
            <div className="text-xs text-muted-foreground/80 truncate mt-0.5">
              Curador: {deal.curator_name}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Progress value={pct} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
            <span>
              <span className="text-foreground font-medium">{formatPlays(earned)}</span>
              {" / "}
              {formatPlays(Number(deal.target_plays ?? 0))} plays
            </span>
            <span className="font-medium text-foreground">{pct}%</span>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => onLog(deal)}>
            <Camera className="h-3.5 w-3.5" />
            Enviar print
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onDetail(deal)}>
            <History className="h-3.5 w-3.5" />
            Histórico
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(deal)}
            aria-label="Excluir deal"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
