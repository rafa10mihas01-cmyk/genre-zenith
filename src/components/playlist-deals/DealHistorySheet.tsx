import { useState } from "react";
import {
  ExternalLink,
  ImageOff,
  Music2,
  ClipboardPaste,
  ChevronDown,
  ChevronRight,
  Headphones,
  X,
} from "lucide-react";
import { format } from "date-fns";

import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { PrintThumbs } from "./PrintThumbs";
import { PastePlaylistsDialog } from "./PastePlaylistsDialog";
import { FraudAlertsPanel } from "./FraudAlertsPanel";
import { DealLogDetailDialog } from "./DealLogDetailDialog";

import {
  computeCuratorStats,
  type CuratorDeal,
  type CuratorDealLog,
  type CuratorDealSong,
  type CuratorPlaylist,
  type CuratorMatchStatus,
} from "@/lib/curatorDealsUtils";

export interface DealHistorySheetProps {
  open: boolean;
  deal: CuratorDeal | null;
  songs?: CuratorDealSong[];
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

const STATUS_ORDER: Record<CuratorMatchStatus, number> = {
  curator: 0,
  editorial: 1,
  suspicious: 2,
  baseline: 3,
  organic: 4,
};

function fmt(n: number): string {
  return Math.round(n).toLocaleString("pt-BR");
}

/**
 * Mini-card de métrica.
 * Padding 16px · radius 12px · fundo #161616 (bg-[hsl(var(--elevated))]) · label cinza · número grande bold.
 */
function MetricCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-[hsl(var(--elevated))] border border-white/[0.04] p-4 transition-colors hover:border-white/[0.08]">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
        {label}
      </div>
      <div className="text-xl font-bold text-foreground mt-1.5 leading-tight">
        {value}
      </div>
    </div>
  );
}

/**
 * Item de playlist (mini-card).
 */
function PlaylistItem({ p }: { p: CuratorPlaylist }) {
  const status = (p.match_status ??
    (p.is_baseline ? "baseline" : "curator")) as CuratorMatchStatus;
  return (
    <li className="flex items-center gap-3 rounded-[10px] border border-white/[0.04] bg-card/40 px-3.5 py-3 transition-all duration-200 hover:bg-[hsl(var(--elevated))] hover:border-white/[0.08]">
      <div className="h-9 w-9 shrink-0 rounded-lg bg-[hsl(var(--elevated))] border border-white/[0.04] flex items-center justify-center">
        <Headphones className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {p.playlist_name}
          </span>
        </div>
        {(p.streams_7d || p.spotify_owner_name || p.added_at_spotify) && (
          <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {p.spotify_owner_name && `${p.spotify_owner_name}`}
            {p.streams_7d ? ` · ${fmt(Number(p.streams_7d))} plays/7d` : ""}
            {p.added_at_spotify ? ` · ${p.added_at_spotify}` : ""}
          </div>
        )}
      </div>
      <Badge
        className={cn(
          "shrink-0 text-[10px] h-5 px-2",
          STATUS_CLASS[status],
        )}
      >
        {STATUS_LABEL[status]}
      </Badge>
    </li>
  );
}

export function DealHistorySheet({
  open,
  deal,
  allLogs,
  allPlaylists,
  onClose,
  onReload,
}: DealHistorySheetProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [longTailOpen, setLongTailOpen] = useState(false);
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

  // Agrupamento de playlists
  const dealPlaylists = deal
    ? allPlaylists.filter((p) => p.deal_id === deal.id)
    : [];
  const sortedPlaylists = [...dealPlaylists].sort((a, b) => {
    const sa = (a.match_status ??
      (a.is_baseline ? "baseline" : "curator")) as CuratorMatchStatus;
    const sb = (b.match_status ??
      (b.is_baseline ? "baseline" : "curator")) as CuratorMatchStatus;
    const orderDiff = STATUS_ORDER[sa] - STATUS_ORDER[sb];
    if (orderDiff !== 0) return orderDiff;
    // dentro do mesmo status, maior streams_7d primeiro
    return Number(b.streams_7d ?? 0) - Number(a.streams_7d ?? 0);
  });

  const principais = sortedPlaylists.slice(0, 6);
  const outras = sortedPlaylists.slice(6, 18);
  const longTail = sortedPlaylists.slice(18);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 flex flex-col gap-0"
      >
        {deal && stats && (
          <>
            {/* HEADER FIXO */}
            <header className="shrink-0 px-6 pt-6 pb-5 border-b border-white/[0.04] bg-background">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-foreground leading-tight truncate">
                    {deal.song_name}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1 truncate">
                    {deal.song_artist ? `${deal.song_artist} · ` : ""}
                    Curador: {deal.curator_name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="h-8 w-8 shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-[hsl(var(--elevated))] hover:text-foreground transition-colors"
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            {/* CORPO COM SCROLL */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
              {/* MÉTRICAS */}
              <section className="grid grid-cols-2 gap-3">
                <MetricCard label="Plays gerados" value={fmt(stats.earned)} />
                <MetricCard
                  label="Meta"
                  value={
                    Number(deal.target_plays) > 0
                      ? fmt(Number(deal.target_plays))
                      : "—"
                  }
                />
                <MetricCard label="Progresso" value={`${stats.pct}%`} />
                <MetricCard
                  label="Velocidade"
                  value={
                    stats.vel !== null ? `${fmt(stats.vel)}/dia` : "—"
                  }
                />
                <MetricCard label="Previsão" value={previsao} />
                <MetricCard label="Investido" value={investido} />
              </section>

              {/* BOTÃO PRINCIPAL */}
              {deal.song_spotify_url && (
                <Button
                  variant="outline"
                  className="w-full h-12 gap-2 text-sm font-medium"
                  onClick={() =>
                    window.open(deal.song_spotify_url!, "_blank")
                  }
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir música no Spotify
                </Button>
              )}

              {/* PLAYLISTS */}
              <section className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Playlists ({dealPlaylists.length})
                    </div>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      Playlists onde sua música está atualmente
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs shrink-0"
                    onClick={() => setPasteOpen(true)}
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                    Colar dados
                  </Button>
                </div>

                {dealPlaylists.length === 0 ? (
                  <div className="rounded-xl border border-white/[0.04] bg-[hsl(var(--elevated))]/50 py-8 flex flex-col items-center text-center gap-2">
                    <div className="h-10 w-10 rounded-full bg-[hsl(var(--elevated))] border border-white/[0.04] flex items-center justify-center">
                      <Music2 className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="text-sm text-foreground">
                      Nenhuma playlist registrada
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Use "Colar dados" para importar do Spotify for Artists
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* 🔥 PRINCIPAIS */}
                    {principais.length > 0 && (
                      <div className="rounded-xl bg-[hsl(var(--elevated))]/60 border border-white/[0.04] p-3">
                        <div className="flex items-center gap-2 mb-2.5 px-1">
                          <span className="text-sm">🔥</span>
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                            Principais
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            ({principais.length})
                          </span>
                        </div>
                        <ul className="space-y-2">
                          {principais.map((p) => (
                            <PlaylistItem key={p.id} p={p} />
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* ⚡ OUTRAS */}
                    {outras.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2.5 px-1">
                          <span className="text-sm">⚡</span>
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Outras playlists
                          </span>
                          <span className="text-[10px] text-muted-foreground/70">
                            ({outras.length})
                          </span>
                        </div>
                        <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                          {outras.map((p) => (
                            <PlaylistItem key={p.id} p={p} />
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 💤 LONG TAIL */}
                    {longTail.length > 0 && (
                      <Collapsible
                        open={longTailOpen}
                        onOpenChange={setLongTailOpen}
                      >
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="w-full flex items-center justify-between gap-2 rounded-xl border border-white/[0.04] bg-card/40 px-4 py-3 text-left transition-colors hover:bg-[hsl(var(--elevated))]"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm">💤</span>
                              <span className="text-xs font-medium text-foreground">
                                {longTailOpen
                                  ? "Ocultar long tail"
                                  : `Ver mais playlists (${longTail.length})`}
                              </span>
                            </div>
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 text-muted-foreground transition-transform duration-200",
                                longTailOpen && "rotate-180",
                              )}
                            />
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2">
                          <ul className="space-y-2">
                            {longTail.map((p) => (
                              <PlaylistItem key={p.id} p={p} />
                            ))}
                          </ul>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                )}
              </section>

              {/* ANTI-FRAUDE */}
              <section className="rounded-xl border border-white/[0.04] bg-[hsl(var(--elevated))]/40 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm">🛡️</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    Monitoramento
                  </span>
                </div>
                <FraudAlertsPanel dealId={deal.id} onReload={onReload} />
              </section>

              {/* HISTÓRICO */}
              <section>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Histórico de crescimento
                </div>

                {reversedLogs.length === 0 ? (
                  <div className="rounded-xl border border-white/[0.04] bg-[hsl(var(--elevated))]/50 py-10 flex flex-col items-center text-center gap-2">
                    <div className="h-10 w-10 rounded-full bg-[hsl(var(--elevated))] border border-white/[0.04] flex items-center justify-center">
                      <ImageOff className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="text-sm text-foreground">
                      Nenhum registro ainda
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Envie o primeiro print para começar
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
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
                          className="rounded-xl border border-white/[0.04] bg-[hsl(var(--elevated))]/40 p-4 transition-colors hover:bg-[hsl(var(--elevated))]/70"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xl font-bold text-foreground leading-tight">
                                {Number(log.total_plays).toLocaleString(
                                  "pt-BR",
                                )}
                                <span className="text-xs font-normal text-muted-foreground ml-1.5">
                                  plays
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                {log.is_baseline && (
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px] h-4 px-1.5"
                                  >
                                    Baseline
                                  </Badge>
                                )}
                                <span className="text-[11px] text-muted-foreground">
                                  {format(
                                    new Date(log.created_at),
                                    "dd/MM HH:mm",
                                  )}
                                </span>
                              </div>
                              {log.note && (
                                <div className="text-xs text-muted-foreground mt-1.5 truncate">
                                  {log.note}
                                </div>
                              )}
                            </div>
                            {!isFirstChronological && !log.is_baseline && (
                              <div
                                className={cn(
                                  "text-sm font-semibold shrink-0 px-2 py-1 rounded-md",
                                  deltaPositive
                                    ? "text-success bg-success/10"
                                    : "text-destructive bg-destructive/10",
                                )}
                              >
                                {deltaPositive ? "+" : "−"}
                                {Math.abs(delta).toLocaleString("pt-BR")}
                              </div>
                            )}
                          </div>
                          {log.print_urls && log.print_urls.length > 0 && (
                            <div className="mt-3">
                              <PrintThumbs urls={log.print_urls} size="md" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
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
