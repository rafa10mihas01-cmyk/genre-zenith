import { useMemo } from "react";
import { format } from "date-fns";
import { ExternalLink, ImageOff, Music2, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PrintThumbs } from "./PrintThumbs";

import {
  dedupeCuratorPlaylists,
  type CuratorDealLog,
  type CuratorDealSong,
  type CuratorPlaylist,
  type CuratorMatchStatus,
} from "@/lib/curatorDealsUtils";

const STATUS_LABEL: Record<CuratorMatchStatus, string> = {
  curator: "Do curador",
  baseline: "Inicial",
  editorial: "Editorial",
  algorithmic: "Algorítmica",
  suspicious: "Suspeita",
  organic: "Orgânica",
};

const STATUS_CLASS: Record<CuratorMatchStatus, string> = {
  curator: "bg-success/15 text-success",
  baseline: "bg-muted/40 text-muted-foreground",
  editorial: "bg-primary/15 text-primary",
  algorithmic: "bg-muted/40 text-muted-foreground",
  suspicious: "bg-destructive/15 text-destructive",
  organic: "bg-muted/30 text-muted-foreground",
};

export interface DealLogDetailDialogProps {
  open: boolean;
  log: CuratorDealLog | null;
  prevLog?: CuratorDealLog | null;
  song?: CuratorDealSong | null;
  fallbackSongName?: string;
  fallbackSongCover?: string | null;
  fallbackArtist?: string | null;
  playlists: CuratorPlaylist[];
  onClose: () => void;
}

function formatPlays(n: number | bigint | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0";
  return v.toLocaleString("pt-BR");
}

export function DealLogDetailDialog({
  open,
  log,
  prevLog,
  song,
  fallbackSongName,
  fallbackSongCover,
  fallbackArtist,
  playlists,
  onClose,
}: DealLogDetailDialogProps) {
  const linkedPlaylists = useMemo(() => {
    if (!log) return [] as CuratorPlaylist[];
    const isBaseline = log.is_initial_capture_event === true;
    const songId = log.song_id ?? null;

    const filtered = playlists.filter((p) => {
      if (p.deal_id !== log.deal_id) return false;
      if (songId && (p as any).song_id) {
        return (p as any).song_id === songId;
      }
      if (isBaseline) return p.is_initial_roster === true;
      return true;
    });

    return dedupeCuratorPlaylists(filtered, song ? [{ id: song.id, song_name: song.song_name }] : []).sort(
      (a, b) => (Number(b.streams_7d) || 0) - (Number(a.streams_7d) || 0),
    );
  }, [log, playlists, song]);

  if (!log) return null;

  const delta =
    prevLog && !log.is_initial_capture_event
      ? Number(log.total_plays) - Number(prevLog.total_plays)
      : 0;
  const deltaPositive = delta >= 0;

  const songCover = song?.song_cover_url ?? fallbackSongCover ?? null;
  const songName = song?.song_name ?? fallbackSongName ?? "Música";
  const songArtist = song?.song_artist ?? fallbackArtist ?? null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto p-0 gap-0">
        {/* HEADER com capa da música */}
        <DialogHeader className="p-5 pb-4 border-b border-white/[0.04]">
          <div className="flex items-start gap-3">
            {songCover ? (
              <img
                src={songCover}
                alt=""
                className="h-14 w-14 rounded-lg object-cover shrink-0 ring-1 ring-white/[0.06]"
              />
            ) : (
              <div className="h-14 w-14 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
                <Music2 className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1 pr-7">
              <DialogTitle className="text-base font-semibold leading-tight truncate">
                {songName}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground truncate mt-0.5">
                {songArtist ?? "—"} · {format(new Date(log.created_at), "dd/MM HH:mm")}
              </DialogDescription>
              <div className="flex items-center gap-2 mt-2">
                {log.is_initial_capture_event ? (
                  <Badge variant="secondary" className="text-[10px] h-5 px-2">
                    Baseline · estado inicial
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] h-5 px-2">
                    Atualização
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* PLAYS BLOCK */}
        <div className="px-5 pt-4">
          <div className="rounded-xl bg-[hsl(var(--elevated))]/60 border border-white/[0.04] px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Plays registrados
              </div>
              <div className="text-2xl font-bold tabular-nums leading-tight mt-0.5">
                {formatPlays(log.total_plays)}
              </div>
            </div>
            {prevLog && !log.is_initial_capture_event && (
              <div
                className={cn(
                  "text-sm font-semibold px-2.5 py-1 rounded-md tabular-nums",
                  deltaPositive
                    ? "text-success bg-success/10"
                    : "text-destructive bg-destructive/10",
                )}
              >
                {deltaPositive ? "+" : "−"}
                {formatPlays(Math.abs(delta))}
              </div>
            )}
          </div>
        </div>

        {/* NOTA DO ADMIN */}
        {log.note && (
          <div className="px-5 pt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Observação
            </div>
            <div className="text-sm text-foreground/90 rounded-lg bg-muted/30 px-3 py-2 leading-relaxed">
              {log.note}
            </div>
          </div>
        )}

        {/* PRINTS */}
        {log.print_urls && log.print_urls.length > 0 && (
          <div className="px-5 pt-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Prints enviados ({log.print_urls.length})
            </div>
            <PrintThumbs urls={log.print_urls} size="md" />
          </div>
        )}

        {/* PLAYLISTS VINCULADAS */}
        <div className="px-5 pt-5 pb-5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            {log.is_initial_capture_event ? "Playlists iniciais" : "Playlists do registro"}{" "}
            ({linkedPlaylists.length})
          </div>

          {linkedPlaylists.length === 0 ? (
            <div className="rounded-xl border border-white/[0.04] bg-[hsl(var(--elevated))]/40 py-8 flex flex-col items-center text-center gap-2">
              <div className="h-9 w-9 rounded-full bg-muted/40 flex items-center justify-center">
                <ImageOff className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-sm text-foreground">Nenhuma playlist vinculada</div>
              <div className="text-xs text-muted-foreground">
                Esse registro não trouxe playlists associadas
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {linkedPlaylists.map((p) => {
                const status = (p.match_status as CuratorMatchStatus) ?? "organic";
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-lg border border-white/[0.04] bg-[hsl(var(--elevated))]/40 px-3 py-2.5 hover:bg-[hsl(var(--elevated))]/70 transition-colors"
                  >
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt=""
                        className="h-10 w-10 rounded-md object-cover shrink-0"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-md bg-muted/40 flex items-center justify-center shrink-0">
                        <Music2 className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate leading-tight">
                        {p.playlist_name}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span
                          className={cn(
                            "text-[9px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded-full",
                            STATUS_CLASS[status],
                          )}
                        >
                          {STATUS_LABEL[status]}
                        </span>
                        {p.spotify_owner_name && (
                          <span className="text-[10px] text-muted-foreground truncate">
                            · {p.spotify_owner_name}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] font-semibold tabular-nums leading-tight">
                        {formatPlays(p.streams_7d)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        plays 7d
                      </div>
                    </div>
                    {p.spotify_url && (
                      <a
                        href={p.spotify_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Abrir no Spotify"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
