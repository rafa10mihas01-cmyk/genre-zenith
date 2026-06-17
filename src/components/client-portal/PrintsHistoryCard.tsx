// Histórico de prints (coletas) do portal do cliente.
// Mesma UI da página antiga /campanha/:token.
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight, Image as ImageIcon, Music2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PrintThumbs } from "@/components/playlist-deals/PrintThumbs";

export type PrintsHistoryPlaylist = {
  playlist_id: string;
  playlist_name: string;
  image_url: string | null;
  plays: number;
};

export type PrintsHistoryEntry = {
  captured_at: string;
  is_initial_capture: boolean;
  playlists_count: number;
  total_plays: number;
  print_url: string | null;
  print_urls: string[];
  playlists: PrintsHistoryPlaylist[];
};

export function PrintsHistoryCard({
  history,
  coverUrl,
}: {
  history: PrintsHistoryEntry[];
  coverUrl?: string | null;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (!history || history.length === 0) {
    return (
      <Card className="border-border">
        <CardContent className="p-6 text-sm text-muted-foreground text-center">
          As provas de entrega vão aparecer aqui assim que o curador enviar o primeiro print.
        </CardContent>
      </Card>
    );
  }
  const ordered = [...history];
  return (
    <Card className="border-border">
      <CardContent className="p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight">Histórico de prints</h2>
            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
              Prints enviados pelo curador a partir do Spotify for Artists
            </p>
          </div>
          <span className="text-[12px] text-muted-foreground shrink-0">
            {ordered.length} {ordered.length === 1 ? "registro" : "registros"}
          </span>
        </div>

        <div className="max-h-[600px] overflow-y-auto pr-1 -mr-1 scroll-smooth space-y-2.5">
          {ordered.map((entry, idx) => {
            const prev = ordered[idx - 1];
            const delta = prev ? Number(entry.total_plays) - Number(prev.total_plays) : 0;
            const dt = new Date(entry.captured_at);
            const dayLabel = dt.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
            const time = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
            const prints = (entry.print_urls && entry.print_urls.length > 0)
              ? entry.print_urls
              : (entry.print_url ? [entry.print_url] : []);
            const snapPlaylists = entry.playlists ?? [];
            const snapshotKey = `${entry.captured_at}-${idx}`;
            return (
              <details
                key={snapshotKey}
                open={openKey === snapshotKey}
                onToggle={(event) => {
                  const isOpen = (event.currentTarget as HTMLDetailsElement).open;
                  setOpenKey((current) => (isOpen ? snapshotKey : current === snapshotKey ? null : current));
                }}
                className="group/snap rounded-xl border border-border bg-card overflow-hidden [&[open]>summary_.snapchev]:rotate-90"
              >
                <summary className="cursor-pointer list-none p-3.5 flex items-center gap-3 hover:bg-muted/30 transition-colors">
                  {coverUrl ? (
                    <img src={coverUrl} alt={`Capa de ${dayLabel}`} loading="lazy" className="h-11 w-11 rounded-lg object-cover ring-1 ring-border shrink-0 bg-muted/40" />
                  ) : (
                    <div className="h-11 w-11 rounded-lg bg-muted/40 ring-1 ring-border flex items-center justify-center shrink-0">
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold leading-tight capitalize">
                      {dayLabel} · {time}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                      {entry.is_initial_capture ? "Início da medição" : "Coleta"} · {entry.playlists_count} {entry.playlists_count === 1 ? "playlist" : "playlists"}
                      {prints.length > 0 && (<> · {prints.length} {prints.length === 1 ? "print" : "prints"}</>)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[13px] font-bold tabular-nums leading-tight">
                      {Number(entry.total_plays).toLocaleString("pt-BR")}
                    </div>
                    <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80 mt-0.5">total da playlist</div>
                    {prev && delta !== 0 && (
                      <div className="mt-1.5">
                        <div className={cn("text-[11px] font-semibold tabular-nums leading-none", delta >= 0 ? "text-success" : "text-warning")}>
                          {delta >= 0 ? "+" : "−"}{Math.abs(delta).toLocaleString("pt-BR")}
                        </div>
                        <div className="text-[9.5px] text-muted-foreground/80 mt-0.5 leading-tight">
                          {delta >= 0 ? "novos plays desde o último print" : "Spotify revisou plays"}
                        </div>
                      </div>
                    )}
                  </div>
                  <ChevronRight className="snapchev h-4 w-4 text-muted-foreground shrink-0 transition-transform ml-1" />
                </summary>

                <div className="border-t border-border/60 px-4 py-4 bg-background/40 space-y-4">
                  {prints.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                        Prints ({prints.length})
                      </div>
                      <PrintThumbs urls={prints} size="md" />
                    </div>
                  )}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                      Playlists do registro ({snapPlaylists.length})
                    </div>
                    {snapPlaylists.length === 0 ? (
                      <div className="text-[12px] text-muted-foreground italic py-2">
                        Nenhuma playlist vinculada a este registro.
                      </div>
                    ) : (
                      <ul className="space-y-1.5">
                        {snapPlaylists.map((pl) => (
                          <li key={pl.playlist_id} className="flex items-center gap-3 rounded-md border border-border/40 bg-muted/30 px-2.5 py-2">
                            {pl.image_url ? (
                              <img src={pl.image_url} alt="" className="h-9 w-9 rounded-md object-cover shrink-0 ring-1 ring-border/50" />
                            ) : (
                              <div className="h-9 w-9 rounded-md bg-muted/40 flex items-center justify-center shrink-0">
                                <Music2 className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-[12.5px] font-medium leading-tight truncate">{pl.playlist_name}</div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[12.5px] font-semibold tabular-nums leading-tight">
                                {Number(pl.plays ?? 0).toLocaleString("pt-BR")}
                              </div>
                              <div className="text-[10px] text-muted-foreground">plays</div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
