import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Camera,
  History,
  Trash2,
  MoreHorizontal,
  CheckCircle2,
  Lock,
  Pencil,
  Headphones,
  User,
  Copy,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusDot, type StatusVariant } from "@/components/ui/status-dot";
import { MetricCell } from "@/components/ui/metric-cell";
import { DealDeliveryBadge } from "@/components/playlist-deals/DealDeliveryBadge";
import { useDeliveryStatusMap } from "@/hooks/useDeliveryStatus";
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
export function DealRow(props: DealRowProps) {
  const { deal, logs, playlists, songs = [], progress } = props;
  const deliveryMap = useDeliveryStatusMap([deal.id]);
  const stats = computeCuratorStats(deal, logs, playlists, progress ?? null);
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
    const s = (p.match_status ?? (p.is_baseline ? "baseline" : "curator")) as string;
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

  const handleCopyCuratorLink = async () => {
    const { curatorPublicUrl } = await import("@/lib/curatorPublicUrl");
    const url = curatorPublicUrl({ slug: deal.slug, public_token: deal.public_token });
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link do curador copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const handleCopyClientLink = async () => {
    const { clientCampaignUrl } = await import("@/lib/curatorPublicUrl");
    const first = (songs ?? []).find((s) => !!s.slug || !!s.client_token);
    const slug = first?.slug ?? null;
    const token = first?.client_token ?? deal.client_token ?? null;
    if (!slug && !token) {
      toast.error("Link do cliente indisponível");
      return;
    }
    const url = clientCampaignUrl({ slug, client_token: token });
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link do cliente copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  return (
    <div
      className={cn(
        "group relative rounded-2xl border border-border/50 bg-card transition-colors flex flex-col h-full",
        "hover:border-foreground/20 hover:bg-[hsl(var(--elevated))]",
      )}
    >
      {/* Linha 1 — identidade */}
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-2.5 min-w-0">
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
          {/* Linha de chips — abaixo do nome pra não comer espaço */}
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <span
              className={cn(
                "inline-flex items-center h-5 px-2 rounded-full text-[10px] font-semibold uppercase tracking-wide border",
                deal.origin === "campaign"
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-muted text-muted-foreground border-border",
              )}
              title={deal.origin === "campaign" ? "Deal criado via aprovação de campanha" : "Deal criado manualmente"}
            >
              {deal.origin === "campaign" ? "Campanha" : "Manual"}
            </span>
            <DealDeliveryBadge row={deliveryMap[deal.id]} />
          </div>
        </button>
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

        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
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
            <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
              <DropdownMenuItem className="gap-2 rounded-lg" onClick={() => props.onDetail(deal)}>
                <History className="h-4 w-4" /> Abrir histórico
              </DropdownMenuItem>
              {!isClosed && props.onClose && hasBaseline && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="gap-2 rounded-lg" onClick={() => props.onClose!(deal)}>
                    <CheckCircle2 className="h-4 w-4" /> Encerrar deal
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 rounded-lg" onClick={handleCopyCuratorLink}>
                <Headphones className="h-4 w-4" /> Link do curador
                <Copy className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2 rounded-lg" onClick={handleCopyClientLink}>
                <User className="h-4 w-4" /> Link do cliente
                <Copy className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
              </DropdownMenuItem>
              {!isClosed && props.onEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="gap-2 rounded-lg" onClick={() => props.onEdit!(deal)}>
                    <Pencil className="h-4 w-4" /> Editar deal
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
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
