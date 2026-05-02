import { useState } from "react";
import { ExternalLink, ImageOff, Music2, ClipboardPaste } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PrintThumbs } from "./PrintThumbs";
import { PastePlaylistsDialog } from "./PastePlaylistsDialog";
import { FraudAlertsPanel } from "./FraudAlertsPanel";

import {
  computeCuratorStats,
  type CuratorDeal,
  type CuratorDealLog,
  type CuratorPlaylist,
  type CuratorMatchStatus,
} from "@/lib/curatorDealsUtils";

export interface DealHistorySheetProps {
  open: boolean;
  deal: CuratorDeal | null;
  allLogs: CuratorDealLog[];
  allPlaylists: CuratorPlaylist[];
  onClose: () => void;
  onReload?: () => void;
}

const STATUS_LABEL: Record<CuratorMatchStatus, string> = {
  curator: "Do curador",
  baseline: "Inicial",
  editorial: "Editorial",
  suspicious: "Suspeita",
  organic: "Orgânica",
};

const STATUS_CLASS: Record<CuratorMatchStatus, string> = {
  curator: "bg-success/15 text-success border-0",
  baseline: "bg-muted/40 text-muted-foreground border border-border",
  editorial: "bg-primary/15 text-primary border-0",
  suspicious: "bg-destructive/15 text-destructive border-0",
  organic: "bg-muted/30 text-muted-foreground border border-border",
};

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

export function DealHistorySheet({
  open, deal, allLogs, allPlaylists, onClose, onReload,
}: DealHistorySheetProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const stats = deal ? computeCuratorStats(deal, allLogs, allPlaylists) : null;

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
              <SheetTitle className="font-medium text-base">{deal.song_name}</SheetTitle>
              <SheetDescription className="text-sm text-muted-foreground">
                {deal.song_artist ? `${deal.song_artist} · ` : ""}
                Curador: {deal.curator_name}
              </SheetDescription>
            </SheetHeader>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3 mt-6">
              <StatCell label="Plays gerados" value={fmt(stats.earned)} />
              <StatCell
                label="Meta"
                value={Number(deal.target_plays) > 0 ? fmt(Number(deal.target_plays)) : "—"}
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
            {deal.song_spotify_url && (
              <Button
                variant="outline"
                className="w-full gap-2 mt-4"
                onClick={() => window.open(deal.song_spotify_url, "_blank")}
              >
                <ExternalLink className="h-4 w-4" />
                Abrir música no Spotify
              </Button>
            )}

            <Separator className="my-6" />

            {/* Playlists */}
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-muted-foreground">
                Playlists
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setPasteOpen(true)}
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                Colar dados
              </Button>
            </div>
            {(() => {
              const dealPlaylists = allPlaylists.filter((p) => p.deal_id === deal.id);
              if (dealPlaylists.length === 0) {
                return (
                  <div className="py-6 flex flex-col items-center text-center gap-2">
                    <div className="h-9 w-9 rounded-full bg-muted/40 border border-border flex items-center justify-center">
                      <Music2 className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Nenhuma playlist registrada
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Use "Colar dados" para importar do Spotify for Artists
                    </div>
                  </div>
                );
              }
              // Ordenação: curator → editorial → suspicious → baseline → organic
              const order: Record<CuratorMatchStatus, number> = {
                curator: 0, editorial: 1, suspicious: 2, baseline: 3, organic: 4,
              };
              const sorted = [...dealPlaylists].sort((a, b) => {
                const sa = (a.match_status ?? (a.is_baseline ? "baseline" : "curator")) as CuratorMatchStatus;
                const sb = (b.match_status ?? (b.is_baseline ? "baseline" : "curator")) as CuratorMatchStatus;
                return order[sa] - order[sb];
              });
              return (
                <ul className="space-y-2">
                  {sorted.map((p) => {
                    const status = (p.match_status ?? (p.is_baseline ? "baseline" : "curator")) as CuratorMatchStatus;
                    return (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-foreground truncate">
                              {p.playlist_name}
                            </span>
                            <Badge className={cn("shrink-0 text-[10px] h-4 px-1.5", STATUS_CLASS[status])}>
                              {STATUS_LABEL[status]}
                            </Badge>
                          </div>
                          {(p.streams_7d || p.spotify_owner_name) && (
                            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                              {p.spotify_owner_name && `${p.spotify_owner_name}`}
                              {p.streams_7d ? ` · ${fmt(Number(p.streams_7d))} plays/7d` : ""}
                              {p.added_at_spotify ? ` · ${p.added_at_spotify}` : ""}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              );
            })()}

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
                  const prev = reversedLogs[idx + 1];
                  const isFirstChronological = !prev;
                  const delta = prev
                    ? Number(log.total_plays) - Number(prev.total_plays)
                    : 0;
                  const deltaPositive = delta >= 0;

                  return (
                    <div
                      key={log.id}
                      className="flex flex-col gap-2 py-3 border-b border-border/50 last:border-b-0"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-foreground">
                              {Number(log.total_plays).toLocaleString("pt-BR")} plays
                            </div>
                            {log.is_baseline && (
                              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                                Baseline
                              </Badge>
                            )}
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
                          {!isFirstChronological && !log.is_baseline && (
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
                      {log.print_urls && log.print_urls.length > 0 && (
                        <PrintThumbs urls={log.print_urls} size="sm" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </SheetContent>
      <PastePlaylistsDialog
        open={pasteOpen}
        deal={deal}
        onClose={() => setPasteOpen(false)}
        onImported={() => onReload?.()}
      />
    </Sheet>
  );
}
