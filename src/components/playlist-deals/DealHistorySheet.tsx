import { ExternalLink, ImageOff } from "lucide-react";
import { format } from "date-fns";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { computeStats, type PlaylistDeal, type PlaylistDealLog } from "@/lib/playlistDealsUtils";

export interface DealHistorySheetProps {
  open: boolean;
  deal: PlaylistDeal | null;
  allLogs: PlaylistDealLog[];
  onClose: () => void;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("pt-BR");
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/40 border border-border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium text-foreground mt-1">{value}</div>
    </div>
  );
}

export function DealHistorySheet({ open, deal, allLogs, onClose }: DealHistorySheetProps) {
  const stats = deal ? computeStats(deal, allLogs) : null;

  const reversedLogs = stats ? [...stats.dealLogs].reverse() : [];

  const previsao =
    !stats || stats.eta === null
      ? "—"
      : stats.eta === 0
      ? "Concluído"
      : `${Math.round(stats.eta)} dias`;

  const investido =
    deal && deal.cost !== null && deal.cost !== undefined
      ? `R$ ${Number(deal.cost).toLocaleString("pt-BR")}`
      : "—";

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        {deal && stats && (
          <>
            <SheetHeader className="text-left space-y-1">
              <SheetTitle className="font-medium text-base">{deal.song}</SheetTitle>
              <SheetDescription className="text-sm text-muted-foreground">
                {deal.playlist}
                {deal.curator ? ` · ${deal.curator}` : ""}
              </SheetDescription>
            </SheetHeader>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3 mt-6">
              <StatCell label="Plays gerados" value={fmt(stats.earned)} />
              <StatCell
                label="Meta"
                value={Number(deal.target) > 0 ? fmt(Number(deal.target)) : "—"}
              />
              <StatCell label="Progresso" value={`${stats.pct}%`} />
              <StatCell
                label="Velocidade"
                value={stats.vel !== null ? `${fmt(stats.vel)}/dia` : "—"}
              />
              <StatCell label="Previsão" value={previsao} />
              <StatCell label="Investido" value={investido} />
            </div>

            {/* Spotify link */}
            {deal.spotify_url && (
              <Button
                variant="outline"
                className="w-full gap-2 mt-4"
                onClick={() => window.open(deal.spotify_url!, "_blank")}
              >
                <ExternalLink className="h-4 w-4" />
                Abrir playlist no Spotify
              </Button>
            )}

            <Separator className="my-6" />

            <div className="text-sm font-medium text-muted-foreground mb-3">
              Histórico de prints
            </div>

            {reversedLogs.length === 0 ? (
              <div className="py-10 flex flex-col items-center text-center gap-2">
                <div className="h-10 w-10 rounded-full bg-muted/40 border border-border flex items-center justify-center">
                  <ImageOff className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-sm text-foreground">Nenhum registro ainda</div>
                <div className="text-xs text-muted-foreground">
                  Envie o primeiro print para começar
                </div>
              </div>
            ) : (
              <div>
                {reversedLogs.map((log, idx) => {
                  // reversedLogs is newest first; previous in chronological order
                  // is the next item in this reversed array
                  const prev = reversedLogs[idx + 1];
                  const isFirstChronological = !prev;
                  const delta = prev ? Number(log.count) - Number(prev.count) : 0;
                  const deltaPositive = delta >= 0;

                  return (
                    <div
                      key={log.id}
                      className="flex items-start justify-between gap-3 py-3 border-b border-border/50 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">
                          {Number(log.count).toLocaleString("pt-BR")} plays
                        </div>
                        {log.note && (
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">
                            {log.note}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(log.created_at), "dd/MM HH:mm")}
                        </div>
                        {!isFirstChronological && (
                          <div
                            className={cn(
                              "text-xs mt-0.5",
                              deltaPositive ? "text-success" : "text-destructive",
                            )}
                          >
                            {deltaPositive ? "+" : "−"}
                            {Math.abs(delta).toLocaleString("pt-BR")} plays
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
