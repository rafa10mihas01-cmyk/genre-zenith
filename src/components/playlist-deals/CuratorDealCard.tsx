import { Camera, History, Trash2, Link2, Zap, Clock, AlertTriangle, Calendar as CalendarIcon, Music2, DollarSign, Pencil, CheckCircle2, XCircle, FileDown, Lock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import type { CuratorDeal, CuratorDealLog, CuratorDealSong, CuratorPlaylist } from "@/lib/curatorDealsUtils";
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
  songs?: CuratorDealSong[];
  onLog: (deal: CuratorDeal) => void;
  onDetail: (deal: CuratorDeal) => void;
  onDelete: (deal: CuratorDeal) => void;
  onEdit?: (deal: CuratorDeal) => void;
  onClose?: (deal: CuratorDeal) => void;
  onReopen?: (deal: CuratorDeal) => void;
}

function formatPlays(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}

export function CuratorDealCard({
  deal, logs, playlists, songs = [], onLog, onDetail, onDelete, onEdit, onClose, onReopen,
}: CuratorDealCardProps) {
  const stats = computeCuratorStats(deal, logs, playlists);
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

  const handleCopyLink = async () => {
    const { curatorPublicUrl } = await import("@/lib/curatorPublicUrl");
    const url = curatorPublicUrl({ slug: deal.slug, public_token: deal.public_token });
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado", { description: url });
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  };

  return (
    <Card className="overflow-hidden hover:border-foreground/25 transition-all duration-200 hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
      <CardContent className="p-4 flex flex-col gap-3.5">
        {/* Header: curador + datas + status */}
        <div className="flex items-start gap-3 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
              Curador
            </div>
            <div className="text-[15px] font-semibold tracking-tight text-foreground truncate leading-tight">
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
              "shrink-0 text-[10px] px-2 py-0 h-5 font-medium gap-1",
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

        {/* Música única (compacta) ou contador de músicas */}
        {!showSongList ? (
          <div className="flex items-center gap-2.5 min-w-0 rounded-lg bg-muted/30 ring-1 ring-border/40 px-2.5 py-2">
            {deal.song_cover_url ? (
              <img
                src={deal.song_cover_url}
                alt={deal.song_name}
                className="h-9 w-9 rounded-md object-cover shrink-0"
              />
            ) : (
              <div className="h-9 w-9 rounded-md bg-muted shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-foreground truncate leading-tight">
                {deal.song_name}
              </div>
              {deal.song_artist && (
                <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {deal.song_artist}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Music2 className="h-3 w-3" />
              {songs.length} músicas no deal
            </div>
            <div className="space-y-1">
              {songs.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-md bg-muted/30 ring-1 ring-border/40 px-2.5 py-1.5 min-w-0"
                >
                  {s.song_cover_url ? (
                    <img
                      src={s.song_cover_url}
                      alt={s.song_name}
                      className="h-6 w-6 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-6 w-6 rounded bg-muted shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-foreground truncate font-medium">
                      {s.song_name}
                    </div>
                  </div>
                  {Number(s.daily_goal) > 0 && (
                    <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                      {formatPlays(Number(s.daily_goal))}/dia
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
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

        {/* KPIs em linha única com divisor */}
        {hasBaseline && (
          <div className="grid grid-cols-2 divide-x divide-border/50 rounded-lg bg-muted/30 ring-1 ring-border/40">
            <div className="px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
                Plays totais hoje
              </div>
              <div className="text-[16px] font-bold tabular-nums text-foreground leading-none">
                {formatPlays(latestPlays)}
              </div>
            </div>
            <div className="px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
                Hoje / combinado
              </div>
              <div className="text-[16px] font-bold tabular-nums leading-none">
                <span className="text-primary">{formatPlays(todayPlays)}</span>
                <span className="text-muted-foreground text-[12px] font-semibold"> / {formatPlays(totalDailyGoal)}</span>
              </div>
              {totalDailyGoal > 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  {inRampUp ? "aquecendo — meta liberada em breve" : `${todayPct}% do dia`}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Progresso total */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Combinado total</span>
            <span className="tabular-nums text-[12px] font-semibold text-foreground">{pct}%</span>
          </div>
          <Progress value={pct} className="h-1.5 rounded-full" />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>
              <span className="text-foreground font-medium">{formatPlays(earned)}</span>
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
        <div className="flex items-center gap-1.5 pt-0.5">
          <Button
            size="sm"
            className="flex-1 h-9 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-[13px]"
            onClick={() => onLog(deal)}
          >
            <Camera className="h-3.5 w-3.5" />
            Enviar print
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-[13px] px-3"
            onClick={() => onDetail(deal)}
          >
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
            <Link2 className="h-3.5 w-3.5" />
          </Button>
          {onEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              onClick={() => onEdit(deal)}
              aria-label="Editar deal"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-destructive"
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
