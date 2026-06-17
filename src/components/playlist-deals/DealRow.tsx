import { memo, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Camera,
  Trash2,
  MoreHorizontal,
  Lock,
  Pencil,
  AlertTriangle,
  Zap,
} from "lucide-react";

import type {
  CuratorDeal,
  CuratorDealLog,
  CuratorDealSong,
  CuratorPlaylist,
  CuratorDealProgress,
} from "@/lib/curatorDealsUtils";
import { computeCuratorStats, dedupeCuratorPlaylists } from "@/lib/curatorDealsUtils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusDot, type StatusVariant } from "@/components/ui/status-dot";
import { MetricCell } from "@/components/ui/metric-cell";
import { DealDeliveryBadge } from "@/components/playlist-deals/DealDeliveryBadge";
import { useDeliveryStatusMap, type DeliveryStatusRow } from "@/hooks/useDeliveryStatus";
import { cn } from "@/lib/utils";


export interface DealRowProps {
  deal: CuratorDeal;
  logs: CuratorDealLog[];
  playlists: CuratorPlaylist[];
  songs?: CuratorDealSong[];
  progress?: CuratorDealProgress | null;
  onLog: (deal: CuratorDeal) => void;
  onDetail: (deal: CuratorDeal) => void;
  onDelete: (deal: CuratorDeal) => void;
  onEdit?: (deal: CuratorDeal) => void;
  onDuplicate?: (deal: CuratorDeal) => void;
  onClose?: (deal: CuratorDeal) => void;
  onReopen?: (deal: CuratorDeal) => void;
  onForceCollect?: (deal: CuratorDeal) => Promise<void> | void;
  /** collection_mode da campanha vinculada — 'bot' (Spotify) ou 'spreadsheet' (Excel) */
  campaignCollectionMode?: string | null;
  /**
   * Status de entrega já buscado pelo pai. Quando informado, o card NÃO
   * dispara query própria — fundamental pra performance de scroll.
   */
  deliveryRow?: DeliveryStatusRow | null;
}

function formatPlays(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}

/**
 * Linha compacta tipo "cockpit" (Stripe/Linear) — substitui o CuratorDealCard
 * mantendo as mesmas props e callbacks. Toda a lógica de negócio vem dos
 * mesmos hooks/utilitários — só muda a apresentação.
 */
function DealRowImpl(props: DealRowProps) {
  const { deal, logs, playlists, songs = [], progress, deliveryRow } = props;
  // Fallback: só dispara query individual se o pai NÃO passou deliveryRow.
  // Em listas grandes (PlaylistDeals, etc) o pai deve passar — evita N queries.
  const fallbackMap = useDeliveryStatusMap(deliveryRow === undefined ? [deal.id] : []);
  const resolvedDelivery = deliveryRow !== undefined ? deliveryRow : fallbackMap[deal.id];
  const stats = useMemo(
    () => computeCuratorStats(deal, logs, playlists, progress ?? null),
    [deal, logs, playlists, progress],
  );
  const { earned, pct, vel, eta, hasBaseline, todayPlays } = stats;
  const target = Number(deal.target_plays ?? 0);
  const isClosed = !!deal.closed_at;
  const closedStatus = deal.closed_status;
  const isDone = target > 0 && earned >= target;

  const dealPlaylists = useMemo(
    () => dedupeCuratorPlaylists(playlists.filter((p) => p.deal_id === deal.id), songs),
    [playlists, deal.id, songs],
  );
  const curatorCount = dealPlaylists.filter((p) => {
    const s = (p.match_status ?? (p.is_initial_roster ? "baseline" : "curator")) as string;
    return s === "curator" || s === "baseline";
  }).length;
  const hasWhitelist = curatorCount > 0;

  // Daily goal agregado
  const dailyGoal = songs.length > 0
    ? songs.reduce((sum, s) => sum + Number(s.daily_goal ?? 0), 0)
    : Number(deal.daily_goal ?? 0);
  const todayPct = dailyGoal > 0 ? Math.min(100, Math.round((todayPlays / dailyGoal) * 100)) : 0;

  // Status semântico unificado
  const status: { variant: StatusVariant; label: string; pulse?: boolean } = isClosed
    ? closedStatus === "completed"
      ? { variant: "success", label: "Concluído" }
      : { variant: "neutral", label: "Encerrado" }
    : !hasBaseline
    ? { variant: "warning", label: "Sem baseline" }
    : !hasWhitelist
    ? { variant: "danger", label: "Sem playlists", pulse: true }
    : isDone
    ? { variant: "primary", label: "Pronto p/ encerrar" }
    : { variant: "success", label: "Saudável" };

  const cover = (songs[0]?.song_cover_url ?? deal.song_cover_url) || null;
  const songLabel = songs.length > 1
    ? `${songs.length} músicas`
    : (songs[0]?.song_name ?? deal.song_name);
  const artistLabel = songs.length > 1
    ? deal.curator_name
    : (songs[0]?.song_artist ?? deal.song_artist ?? deal.curator_name);




  return (
    <div
      onClick={() => props.onDetail(deal)}
      style={{ contentVisibility: "auto", containIntrinsicSize: "320px 220px" } as React.CSSProperties}
      className={cn(
        "group relative rounded-2xl border border-border/50 bg-card transition-colors flex flex-col h-full cursor-pointer",
        "hover:border-foreground/20 hover:bg-[hsl(var(--elevated))]",
      )}
    >

      {/* Linha 1 — identidade */}
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-2 min-w-0">
        {cover ? (
          <img
            src={cover}
            alt={String(songLabel)}
            className="h-10 w-10 rounded-md object-cover shrink-0"
          />
        ) : (
          <div className="h-10 w-10 rounded-md bg-muted shrink-0" />
        )}
        <button
          type="button"
          onClick={() => props.onDetail(deal)}
          className="min-w-0 flex-1 text-left"
          aria-label={`Abrir detalhes de ${songLabel}`}
        >
          <div className="flex items-start gap-2 min-w-0">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-foreground truncate leading-tight">
                {deal.curator_name}
              </div>
              <div className="text-[11.5px] text-muted-foreground truncate mt-0.5">
                <span>{songLabel}</span>
                {artistLabel && artistLabel !== deal.curator_name && (
                  <>
                    <span className="mx-1.5 opacity-50">·</span>
                    <span>{artistLabel}</span>
                  </>
                )}
                {curatorCount > 0 && (
                  <>
                    <span className="mx-1.5 opacity-50">·</span>
                    <span>{curatorCount} playlists</span>
                  </>
                )}
              </div>
            </div>
            <StatusDot
              variant={status.variant}
              label={status.label}
              pulse={status.pulse}
              className="shrink-0 mt-1"
            />
          </div>
        </button>
      </div>

      {/* Linha de chips — alinhada à borda do card pra não "boiar" no meio */}
      <div className="flex items-center gap-1.5 flex-wrap px-4 pb-2.5 min-w-0">
        {(() => {
          const fromCampaign = !!deal.campaign_id || deal.origin === "campaign";
          return (
            <span
              className={cn(
                "inline-flex items-center h-5 px-2 rounded-full text-[10px] font-semibold uppercase tracking-wide border",
                fromCampaign
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-muted text-muted-foreground border-border",
              )}
              title={fromCampaign ? "Deal criado via aprovação de campanha" : "Deal criado manualmente"}
            >
              {fromCampaign ? "Campanha" : "Manual"}
            </span>
          );
        })()}
        {props.campaignCollectionMode === "bot" && (
          <span
            className="inline-flex items-center h-5 px-2 rounded-full text-[10px] font-semibold uppercase tracking-wide border bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
            title="Coleta automática via API do Spotify"
          >
            Coleta Spotify
          </span>
        )}
        {props.campaignCollectionMode === "spreadsheet" && (
          <span
            className="inline-flex items-center h-5 px-2 rounded-full text-[10px] font-semibold uppercase tracking-wide border bg-amber-500/10 text-amber-400 border-amber-500/30"
            title="Coleta via importação de planilha Excel"
          >
            Coleta Excel
          </span>
        )}
        <DealDeliveryBadge row={resolvedDelivery} />
      </div>



      {/* Divisor sutil */}
      <div className="mx-4 border-t border-border/40" />

      {/* Linha 2 — métricas + progress + ações (stack vertical pra grid 4-col) */}
      <div className="flex flex-col gap-3 px-4 py-3 min-w-0 mt-auto">
        {hasBaseline ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <MetricCell
                label="Velocidade"
                value={vel !== null ? formatPlays(vel) : "—"}
                suffix={vel !== null ? "/dia" : undefined}
                size="sm"
              />
              <MetricCell
                label="Hoje"
                value={`${todayPct}%`}
                size="sm"
              />
              {eta !== null && eta > 0 ? (
                <MetricCell
                  label="ETA"
                  value={`${eta}d`}
                  size="sm"
                />
              ) : (
                <div />
              )}
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
                <span className="uppercase tracking-[0.12em] font-medium">Progresso</span>
                <span className="tabular-nums font-semibold text-foreground">{pct}%</span>
              </div>
              <Progress value={pct} className="h-1.5 rounded-full" />
              <div className="text-[10.5px] text-muted-foreground tabular-nums">
                {formatPlays(earned)} / {formatPlays(target)}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 min-w-0 text-[12px] text-warning">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate flex-1">Print inicial pendente para liberar baseline</span>
            {deal.campaign_id && <RecalcBaselineInline dealId={deal.id} />}
          </div>
        )}

        <div
          className="flex items-center gap-1.5 shrink-0 ml-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {!isClosed ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2.5 gap-1.5 text-[12px]"
              onClick={() => props.onLog(deal)}
              title="Enviar print"
            >
              <Camera className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Print</span>
            </Button>
          ) : props.onReopen ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2.5 gap-1.5 text-[12px]"
              onClick={() => props.onReopen!(deal)}
            >
              <Lock className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Reabrir</span>
            </Button>
          ) : null}
          {!isClosed && props.onEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label="Editar deal"
              title="Editar deal"
              onClick={() => props.onEdit!(deal)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                aria-label="Mais ações"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5">
              <DropdownMenuItem
                className="gap-2 rounded-lg text-destructive focus:text-destructive"
                onClick={() => props.onDelete(deal)}
              >
                <Trash2 className="h-4 w-4" /> Excluir deal
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

      </div>
    </div>
  );
}

export const DealRow = memo(DealRowImpl, (prev, next) => {
  return (
    prev.deal === next.deal &&
    prev.logs === next.logs &&
    prev.playlists === next.playlists &&
    prev.songs === next.songs &&
    prev.progress === next.progress &&
    prev.campaignCollectionMode === next.campaignCollectionMode &&
    prev.deliveryRow === next.deliveryRow &&
    prev.onLog === next.onLog &&
    prev.onDetail === next.onDetail &&
    prev.onDelete === next.onDelete &&
    prev.onEdit === next.onEdit &&
    prev.onDuplicate === next.onDuplicate &&
    prev.onClose === next.onClose &&
    prev.onReopen === next.onReopen &&
    prev.onForceCollect === next.onForceCollect
  );
});



function RecalcBaselineInline({ dealId }: { dealId: string }) {
  const [loading, setLoading] = useState(false);
  async function handle(e: React.MouseEvent) {
    e.stopPropagation();
    setLoading(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await (supabase.rpc as any)(
        "recalc_curator_deal_baseline_from_spreadsheet",
        { p_deal_id: dealId },
      );
      if (error) throw error;
      if (data?.ok) {
        toast.success("Baseline recalculada a partir da planilha");
      } else {
        const msg =
          data?.error === "campanha_nao_e_planilha"
            ? "Campanha não está em modo planilha"
            : data?.error === "baseline_da_campanha_ausente"
            ? "Planilha de baseline ainda não foi importada"
            : data?.error ?? "Não foi possível recalcular";
        toast.error(msg);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-6 px-2 text-[10.5px] border-warning/40 text-warning hover:bg-warning/15 shrink-0"
      onClick={handle}
      disabled={loading}
    >
      {loading ? "..." : "Recalcular da planilha"}
    </Button>
  );
}
