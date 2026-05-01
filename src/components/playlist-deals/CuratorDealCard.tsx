import { Camera, History, Trash2, Link2, Zap, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import type { CuratorDeal, CuratorDealLog, CuratorPlaylist } from "@/lib/curatorDealsUtils";
import { computeCuratorStats } from "@/lib/curatorDealsUtils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
  const stats = computeCuratorStats(deal, logs, playlists);
  const { earned, pct, vel, eta, latestPlays, todayPlays, todayPct, hasBaseline, newPlaylists } = stats;
  const target = Number(deal.target_plays ?? 0);
  const dailyGoal = Number(deal.daily_goal ?? 0);
  const isDone = target > 0 && earned >= target;

  const statusLabel = !hasBaseline
    ? "Sem baseline"
    : isDone
    ? "Concluído"
    : "Em progresso";

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/curador/${deal.public_token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado", { description: url });
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  };

  return (
    <Card className="overflow-hidden hover:border-foreground/25 transition-colors">
      <CardContent className="p-5 flex flex-col gap-4">
        {/* Linha 1: capa + nome + artista + status */}
        <div className="flex items-start gap-3 min-w-0">
          {deal.song_cover_url ? (
            <img
              src={deal.song_cover_url}
              alt={deal.song_name}
              className="h-10 w-10 rounded-md object-cover shrink-0"
            />
          ) : (
            <div className="h-10 w-10 rounded-md bg-muted shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground truncate">{deal.song_name}</div>
            {deal.song_artist && (
              <div className="text-xs text-muted-foreground truncate">
                {deal.song_artist}
              </div>
            )}
          </div>
          <Badge
            variant={isDone ? "default" : "secondary"}
            className={cn(
              "shrink-0",
              isDone && "bg-success text-success-foreground hover:bg-success/90",
            )}
          >
            {statusLabel}
          </Badge>
        </div>

        {/* Curador */}
        <div className="text-sm text-muted-foreground -mt-1">
          Curador: <span className="text-foreground">{deal.curator_name}</span>
        </div>

        {/* Aviso sem baseline */}
        {!hasBaseline && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
            <span className="text-xs text-warning font-medium">
              Print inicial pendente
            </span>
          </div>
        )}

        {/* KPIs: total atual da música + hoje */}
        {hasBaseline && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-muted/40 border border-border px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Plays totais hoje
              </div>
              <div className="text-base font-semibold tabular-nums text-foreground">
                {formatPlays(latestPlays)}
              </div>
            </div>
            <div className="rounded-lg bg-muted/40 border border-border px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Hoje / combinado
              </div>
              <div className="text-base font-semibold tabular-nums">
                <span className="text-primary">{formatPlays(todayPlays)}</span>
                <span className="text-muted-foreground"> / {formatPlays(dailyGoal)}</span>
                {dailyGoal > 0 && (
                  <span className="text-[11px] text-muted-foreground ml-1">({todayPct}%)</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Progresso total */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
            <span>Combinado total</span>
            <span className="tabular-nums normal-case">{pct}%</span>
          </div>
          <Progress value={pct} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
            <span>
              <span className="text-foreground font-medium">{formatPlays(earned)}</span>
              {" / "}
              {formatPlays(target)} plays
            </span>
          </div>
        </div>

        {/* Velocidade / ETA / playlists novas */}
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          {vel !== null && (
            <span className="inline-flex items-center gap-1">
              <Zap className="h-3 w-3 text-primary" />
              {formatPlays(vel)}/dia
            </span>
          )}
          {eta !== null && eta > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              ~{eta} dias
            </span>
          )}
          {newPlaylists.length > 0 && (
            <Badge className="bg-success/15 text-success hover:bg-success/15 border-0">
              {newPlaylists.length} playlist{newPlaylists.length > 1 ? "s" : ""} nova{newPlaylists.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        {/* Ações */}
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
            className="h-9 w-9 text-muted-foreground hover:text-foreground"
            onClick={handleCopyLink}
            aria-label="Copiar link do curador"
          >
            <Link2 className="h-4 w-4" />
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
