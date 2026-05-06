import { Camera, History, Trash2, Link2, Zap, Clock, AlertTriangle, Calendar as CalendarIcon, Music2, DollarSign, Pencil, CheckCircle2, XCircle, FileDown, Lock, Bot, Loader2, MoreHorizontal, Share2, Headphones, User, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import type { CuratorDeal, CuratorDealLog, CuratorDealSong, CuratorPlaylist, CuratorDealProgress } from "@/lib/curatorDealsUtils";
import { computeCuratorStats } from "@/lib/curatorDealsUtils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface CuratorDealCardProps {
  deal: CuratorDeal;
  logs: CuratorDealLog[];
  playlists: CuratorPlaylist[];
  songs?: CuratorDealSong[];
  progress?: CuratorDealProgress | null;
  onLog: (deal: CuratorDeal) => void;
  onDetail: (deal: CuratorDeal) => void;
  onDelete: (deal: CuratorDeal) => void;
  onEdit?: (deal: CuratorDeal) => void;
  onClose?: (deal: CuratorDeal) => void;
  onReopen?: (deal: CuratorDeal) => void;
  onForceCollect?: (deal: CuratorDeal) => Promise<void> | void;
}

function formatPlays(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}

export function CuratorDealCard({
  deal, logs, playlists, songs = [], progress, onLog, onDetail, onDelete, onEdit, onClose, onReopen, onForceCollect,
}: CuratorDealCardProps) {
  const stats = computeCuratorStats(deal, logs, playlists, progress ?? null);
  const { earned, pct, vel, eta, latestPlays, todayPlays, hasBaseline, newPlaylists } = stats;
  const target = Number(deal.target_plays ?? 0);
  const dailyGoal = Number(deal.daily_goal ?? 0);
  const isDone = target > 0 && earned >= target;
  const totalDailyGoal = songs.length > 0
    ? songs.reduce((sum, s) => sum + Number(s.daily_goal ?? 0), 0)
    : dailyGoal;
  const todayPct = totalDailyGoal > 0
    ? Math.min(100, Math.round((todayPlays / totalDailyGoal) * 100))
    : 0;
  const showSongList = songs.length > 1;

  // Breakdown de origem das playlists deste deal (alinhado com a sheet)
  const dealPlaylists = playlists.filter((p) => p.deal_id === deal.id);
  const plBreakdown = dealPlaylists.reduce(
    (acc, p) => {
      const s = (p.match_status ?? (p.is_baseline ? "baseline" : "curator")) as string;
      if (s === "curator" || s === "baseline") acc.curator += 1;
      else if (s === "editorial" || s === "organic" || s === "suspicious") acc.algo += 1;
      return acc;
    },
    { curator: 0, algo: 0 },
  );
  const hasWhitelist = plBreakdown.curator > 0;

  // Ramp-up: dias desde o início até hoje vs ramp_up_days do deal
  const rampUpDays = Number((deal as unknown as { ramp_up_days?: number }).ramp_up_days ?? 5);
  const startMs = new Date(deal.started_at).getTime();
  const daysSinceStart = Math.floor((Date.now() - startMs) / 86400000) + 1; // dia 1 = hoje no início
  const inRampUp = rampUpDays > 0 && daysSinceStart >= 1 && daysSinceStart <= rampUpDays;
  const rampDayLabel = Math.max(1, Math.min(daysSinceStart, rampUpDays));

  const cost = Number(deal.cost ?? 0) || 0;
  // R$/play: usa plays reais quando houver, senão estima pela meta contratada
  const cppDenom = earned > 0 ? earned : target;
  const costPerPlay = cost > 0 && cppDenom > 0 ? cost / cppDenom : null;
  const cppIsEstimate = earned === 0 && target > 0;
  const formatBRL = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(v);
  const formatCPP = (v: number) => {
    const opts = v < 0.01
      ? { minimumFractionDigits: 4, maximumFractionDigits: 4 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", ...opts }).format(v);
  };

  const isClosed = !!deal.closed_at;
  const closedStatus = deal.closed_status; // 'completed' | 'cancelled' | null
  const statusLabel = isClosed
    ? closedStatus === "completed"
      ? "Concluído"
      : "Encerrado"
    : !hasBaseline
    ? "Sem baseline"
    : isDone
    ? "Pronto p/ encerrar"
    : "Em progresso";

  const handleCopyCuratorLink = async () => {
    const { curatorPublicUrl } = await import("@/lib/curatorPublicUrl");
    const url = curatorPublicUrl({ slug: deal.slug, public_token: deal.public_token });
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link do curador copiado", { description: url });
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  };

  const handleCopyClientLink = async (overrideToken?: string | null) => {
    const { clientCampaignUrl } = await import("@/lib/curatorPublicUrl");
    const tokenToUse = overrideToken ?? deal.client_token ?? null;
    if (!tokenToUse) {
      toast.error("Link do cliente indisponível para esta música");
      return;
    }
    const url = clientCampaignUrl({ client_token: tokenToUse });
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link do cliente copiado", { description: url });
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  };

  // Músicas com client_token (link público por faixa)
  const songsWithClientLink = (songs ?? []).filter((s) => !!s.client_token);
  const showPerSongLinks = songsWithClientLink.length > 1;

  const handleForceCollect = async () => {
    if (!onForceCollect) return;
    try {
      await onForceCollect(deal);
      toast.success("Coleta agendada — robô vai pegar na próxima rodada");
    } catch {
      toast.error("Falha ao agendar coleta");
    }
  };

  return (
    <Card className="overflow-hidden border-border/60 hover:border-foreground/25 transition-all duration-200 hover:shadow-[0_18px_40px_-18px_rgba(0,0,0,0.85),0_0_32px_-8px_hsl(141_76%_48%_/_0.18)] hover:-translate-y-[1px] bg-[linear-gradient(180deg,rgba(255,255,255,0.025)_0%,transparent_40%),hsl(var(--card))]">
      <CardContent className="p-4 flex flex-col gap-2.5">
        {/* Header: curador + datas + status */}
        <div className="flex items-start gap-3 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-0.5">
              Curador
            </div>
            <div className="text-[17px] font-semibold tracking-tight text-foreground truncate leading-tight">
              {deal.curator_name}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1">
              <CalendarIcon className="h-3 w-3" />
              <span className="tabular-nums">
                {format(new Date(deal.started_at), "dd MMM", { locale: ptBR })}
                {deal.ends_at && (
                  <>
                    {" → "}
                    {format(new Date(deal.ends_at), "dd MMM", { locale: ptBR })}
                  </>
                )}
              </span>
            </div>
          </div>
          <Badge
            variant={isClosed && closedStatus === "completed" ? "default" : "secondary"}
            className={cn(
              "shrink-0 text-[10px] px-2.5 py-0.5 h-6 font-semibold gap-1 rounded-full",
              isClosed && closedStatus === "completed" && "bg-success text-success-foreground hover:bg-success/90",
              isClosed && closedStatus === "cancelled" && "bg-destructive/15 text-destructive hover:bg-destructive/20",
              !isClosed && isDone && "bg-primary/15 text-primary",
            )}
          >
            {isClosed && <Lock className="h-2.5 w-2.5" />}
            {statusLabel}
          </Badge>
        </div>

        {/* Banner de fechamento */}
        {isClosed && (
          <div className={cn(
            "rounded-md px-2.5 py-1.5 flex items-center gap-1.5 border",
            closedStatus === "completed"
              ? "border-success/30 bg-success/10"
              : "border-destructive/30 bg-destructive/10",
          )}>
            {closedStatus === "completed"
              ? <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
              : <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
            <span className={cn(
              "text-[11px] font-medium",
              closedStatus === "completed" ? "text-success" : "text-destructive",
            )}>
              {closedStatus === "completed" ? "Concluído" : "Encerrado"}
              {deal.closed_at && (
                <span className="text-muted-foreground font-normal ml-1.5">
                  · {format(new Date(deal.closed_at), "dd MMM", { locale: ptBR })}
                </span>
              )}
            </span>
            {deal.final_report_url && (
              <a
                href={deal.final_report_url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
              >
                <FileDown className="h-3 w-3" />
                Relatório
              </a>
            )}
          </div>
        )}

        {/* Banner de ramp-up (aquecimento) */}
        {inRampUp && (
          <div className="rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-[11px] text-primary font-medium">
              Em aquecimento — dia {rampDayLabel} de {rampUpDays}
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              meta diária liberada após
            </span>
          </div>
        )}

        {/* Música única (mini-card destacado) ou contador de músicas */}
        {!showSongList ? (
          <div className="flex items-center gap-3 min-w-0 rounded-xl bg-[hsl(var(--elevated))] border border-border/40 p-3">
            {deal.song_cover_url ? (
              <img
                src={deal.song_cover_url}
                alt={deal.song_name}
                className="h-12 w-12 rounded-lg object-cover shrink-0 shadow-md"
              />
            ) : (
              <div className="h-12 w-12 rounded-lg bg-muted shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[18px] font-medium text-foreground truncate leading-tight">
                {deal.song_name}
              </div>
              {deal.song_artist && (
                <div className="text-[12px] text-muted-foreground truncate mt-0.5">
                  {deal.song_artist}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold flex items-center gap-1.5">
              <Music2 className="h-3 w-3" />
              {songs.length} músicas no deal
            </div>
            <div className="space-y-1.5">
              {songs.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2.5 rounded-lg bg-[hsl(var(--elevated))] border border-border/40 px-3 py-2 min-w-0"
                >
                  {s.song_cover_url ? (
                    <img
                      src={s.song_cover_url}
                      alt={s.song_name}
                      className="h-7 w-7 rounded-md object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-7 w-7 rounded-md bg-muted shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-foreground truncate font-medium">
                      {s.song_name}
                    </div>
                  </div>
                  {Number(s.daily_goal) > 0 && (
                    <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
                      {formatPlays(Number(s.daily_goal))}/dia
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Origem das playlists — alinhado com a sheet */}
        {!isClosed && (
          hasWhitelist ? (
            <div className="flex items-center gap-3 flex-wrap text-[11px] border-t border-border/40 pt-2.5">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                <span className="text-muted-foreground">Curador</span>
                <span className="tabular-nums font-semibold text-foreground">{plBreakdown.curator}</span>
              </span>
              {plBreakdown.algo > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70" />
                  <span className="text-muted-foreground">Algoritmo</span>
                  <span className="tabular-nums font-semibold text-foreground">{plBreakdown.algo}</span>
                  <span className="text-muted-foreground/70">(visualização)</span>
                </span>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
              <span className="text-[11px] text-destructive font-medium">
                Curador não cadastrou playlists — coleta pausada
              </span>
            </div>
          )
        )}

        {/* Status do robô (auto-coleta) */}
        {!isClosed && songs.length > 0 && (
          <BotStatusRow songs={songs} />
        )}

        {/* Aviso sem baseline */}
        {!hasBaseline && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
            <span className="text-[11px] text-warning font-medium">
              Print inicial pendente
            </span>
          </div>
        )}

        {/* KPIs — números grandes (26px) com labels uppercase 11px */}
        {hasBaseline && (
          <div className="grid grid-cols-2 divide-x divide-border/50 rounded-xl bg-[hsl(var(--elevated))] border border-border/40">
            <div className="px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1.5">
                Plays totais hoje
              </div>
              <div className="text-[26px] font-bold tabular-nums text-foreground leading-none tracking-tight">
                {formatPlays(latestPlays)}
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1.5">
                Hoje / combinado
              </div>
              <div className="text-[26px] font-bold tabular-nums leading-none tracking-tight">
                <span className="text-primary">{formatPlays(todayPlays)}</span>
                <span className="text-muted-foreground text-[14px] font-semibold"> / {formatPlays(totalDailyGoal)}</span>
              </div>
              {totalDailyGoal > 0 && (
                <div className="text-[11px] text-muted-foreground mt-1.5">
                  {inRampUp ? "aquecendo — meta liberada em breve" : `${todayPct}% do dia`}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Progresso total — linha mais visível (h-2.5) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Combinado total</span>
            <span className="tabular-nums text-[14px] font-bold text-foreground">{pct}%</span>
          </div>
          <Progress value={pct} className="h-2.5 rounded-full" />
          <div className="flex items-center justify-between text-[12px] text-muted-foreground tabular-nums">
            <span>
              <span className="text-foreground font-semibold">{formatPlays(earned)}</span>
              {" / "}
              {formatPlays(target)} plays
            </span>
            {newPlaylists.length > 0 && (
              <span className="inline-flex items-center gap-1 text-success font-medium">
                +{newPlaylists.length} nova{newPlaylists.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        {/* Velocidade / ETA / Custo — inline compacto */}
        {(vel !== null || (eta !== null && eta > 0) || cost > 0) && (
          <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground border-t border-border/40 pt-2.5">
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
            {cost > 0 && (
              <span className="inline-flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                {formatBRL(cost)}
                {costPerPlay !== null && (
                  <span className="text-foreground font-medium ml-1">
                    · {formatCPP(costPerPlay)}/play{cppIsEstimate ? " (est.)" : ""}
                  </span>
                )}
              </span>
            )}
          </div>
        )}

        {/* Ações */}
        <div className="flex items-center gap-2 pt-0.5 min-w-0">
          {!isClosed ? (
            <Button
              size="sm"
              className="min-w-0 flex-1 h-9 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-[13px] px-3"
              onClick={() => onLog(deal)}
            >
              <Camera className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Enviar print</span>
            </Button>
          ) : onReopen ? (
            <Button
              size="sm"
              variant="outline"
              className="min-w-0 flex-1 h-9 gap-1.5 text-[13px] px-3"
              onClick={() => onReopen(deal)}
            >
              <Lock className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Reabrir</span>
            </Button>
          ) : (
            <div className="flex-1" />
          )}
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 flex-1 sm:flex-none h-9 gap-1.5 text-[13px] px-3"
            onClick={() => onDetail(deal)}
          >
            <History className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Histórico</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="sm:hidden h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Mais ações"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-xl border-border bg-popover p-1.5">
              {!isClosed && onClose && hasBaseline && (
                <DropdownMenuItem className="gap-2 rounded-lg" onClick={() => onClose(deal)}>
                  <CheckCircle2 className="h-4 w-4" />
                  Encerrar deal
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <div className="px-2 pt-1.5 pb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                Compartilhar
              </div>
              <DropdownMenuItem className="gap-2 rounded-lg items-start py-2" onClick={handleCopyCuratorLink}>
                <Headphones className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm leading-tight">Link do curador</span>
                  <span className="text-[11px] text-muted-foreground leading-tight">Para curadores adicionarem nas playlists</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 rounded-lg items-start py-2"
                onClick={() => handleCopyClientLink()}
                disabled={!deal.client_token}
              >
                <User className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm leading-tight">Link do cliente</span>
                  <span className="text-[11px] text-muted-foreground leading-tight">Painel de acompanhamento do artista</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {!isClosed && onForceCollect && (
                <DropdownMenuItem className="gap-2 rounded-lg" onClick={handleForceCollect}>
                  <Zap className="h-4 w-4" />
                  Forçar coleta
                </DropdownMenuItem>
              )}
              {!isClosed && onEdit && (
                <DropdownMenuItem className="gap-2 rounded-lg" onClick={() => onEdit(deal)}>
                  <Pencil className="h-4 w-4" />
                  Editar deal
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 rounded-lg text-destructive focus:text-destructive" onClick={() => onDelete(deal)}>
                <Trash2 className="h-4 w-4" />
                Excluir deal
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {!isClosed && onClose && hasBaseline && (
            <Button
              variant="ghost"
              size="icon"
              className="hidden sm:inline-flex h-9 w-9 text-muted-foreground hover:text-foreground"
              onClick={() => onClose(deal)}
              aria-label="Encerrar deal"
              title="Encerrar deal"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hidden sm:inline-flex h-9 w-9 text-muted-foreground hover:text-foreground"
                aria-label="Compartilhar links"
                title="Compartilhar"
              >
                <Share2 className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-xl border-border bg-popover p-1.5">
              <div className="px-2 pt-1.5 pb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                Compartilhar
              </div>
              <DropdownMenuItem className="gap-2 rounded-lg items-start py-2.5" onClick={handleCopyCuratorLink}>
                <Headphones className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm leading-tight font-medium">Link do curador</span>
                  <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                    Para curadores adicionarem a música nas playlists
                  </span>
                </div>
                <Copy className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              </DropdownMenuItem>
              {showPerSongLinks ? (
                <>
                  <div className="px-2 pt-2 pb-1 text-[11px] text-muted-foreground leading-tight">
                    Link do cliente — uma URL para cada música
                  </div>
                  {songsWithClientLink.map((s) => (
                    <DropdownMenuItem
                      key={s.id}
                      className="gap-2 rounded-lg items-center py-2"
                      onClick={() => handleCopyClientLink(s.client_token ?? null)}
                    >
                      <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm leading-tight font-medium truncate flex-1" title={s.song_name}>
                        {s.song_name}
                      </span>
                      <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </DropdownMenuItem>
                  ))}
                </>
              ) : (
                <DropdownMenuItem
                  className="gap-2 rounded-lg items-start py-2.5"
                  onClick={() => handleCopyClientLink(songsWithClientLink[0]?.client_token ?? deal.client_token ?? null)}
                  disabled={!deal.client_token && !songsWithClientLink[0]?.client_token}
                >
                  <User className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm leading-tight font-medium">Link do cliente</span>
                    <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                      Painel de acompanhamento para o artista/cliente
                    </span>
                  </div>
                  <Copy className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {!isClosed && onForceCollect && (
            <Button
              variant="ghost"
              size="icon"
              className="hidden sm:inline-flex h-9 w-9 text-muted-foreground hover:text-primary"
              onClick={handleForceCollect}
              aria-label="Forçar coleta agora"
              title="Forçar coleta agora"
            >
              <Zap className="h-3.5 w-3.5" />
            </Button>
          )}
          {!isClosed && onEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="hidden sm:inline-flex h-9 w-9 text-muted-foreground hover:text-foreground"
              onClick={() => onEdit(deal)}
              aria-label="Editar deal"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:inline-flex h-9 w-9 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(deal)}
            aria-label="Excluir deal"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Mini-painel do robô: status + countdown pra próxima coleta
function BotStatusRow({ songs }: { songs: CuratorDealSong[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const active = songs.filter((s) => s.auto_collect);
  if (active.length === 0) {
    return (
      <div className="rounded-md border border-border/40 bg-[hsl(var(--elevated))] px-2.5 py-1.5 flex items-center gap-1.5">
        <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-[11px] text-muted-foreground">Auto-coleta desligada</span>
      </div>
    );
  }

  const queued = active.find((s) => s.auto_collect_status === "queued");
  const errored = active.find((s) => s.auto_collect_status === "error");

  // próxima coleta = menor next_auto_collect_at entre as ativas
  const nextTs = active
    .map((s) => (s.next_auto_collect_at ? new Date(s.next_auto_collect_at).getTime() : Number.POSITIVE_INFINITY))
    .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);

  const lastTs = active
    .map((s) => (s.last_auto_collect_at ? new Date(s.last_auto_collect_at).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);

  const diff = Number.isFinite(nextTs) ? nextTs - now : null;

  let icon = <Bot className="h-3.5 w-3.5 text-primary shrink-0" />;
  let tone = "border-primary/25 bg-primary/5 text-primary";
  let label: string;

  if (queued) {
    icon = <Loader2 className="h-3.5 w-3.5 text-primary shrink-0 animate-spin" />;
    label = "Robô coletando agora…";
  } else if (errored) {
    icon = <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />;
    tone = "border-warning/30 bg-warning/10 text-warning";
    label = "Última tentativa falhou — vai tentar de novo";
  } else if (diff === null) {
    label = "Robô agendado";
  } else if (diff <= 0) {
    label = "Pronto pra coletar — esperando o robô bater";
  } else {
    label = `Próxima coleta em ${formatCountdown(diff)}`;
  }

  return (
    <div className={cn("rounded-md border px-2.5 py-1.5 flex items-center gap-1.5", tone)}>
      {icon}
      <span className="text-[11px] font-medium tabular-nums">{label}</span>
      {lastTs > 0 && (
        <span className="text-[10px] text-muted-foreground ml-auto">
          última {formatRelative(now - lastTs)}
        </span>
      )}
    </div>
  );
}

function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}min`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function formatRelative(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}
