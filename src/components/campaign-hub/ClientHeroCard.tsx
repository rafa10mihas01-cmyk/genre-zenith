import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarDays, Music2, TrendingUp, ExternalLink, ListMusic, Clock, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CampaignHubCampaign, EcoAllocation } from "./types";
import { deliveryPct } from "@/lib/campaignPct";

type EcoSnap = {
  managed_playlist_id: string;
  plays_24h: number | null;
  plays_7d: number | null;
  plays_28d: number | null;
  captured_at: string;
};

type Stage = "approval" | "rejected" | "live";

type Props = {
  camp: CampaignHubCampaign;
  delivered: number;
  goal: number;
  daysElapsed: number;
  daysTotal: number;
  allocations: EcoAllocation[];
  snapshots: EcoSnap[];
  stage: Stage;
};

function formatPlays(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}

function formatFull(n: number): string {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "agora";
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

export function ClientHeroCard({
  camp, delivered, goal, daysElapsed, daysTotal, allocations, snapshots, stage,
}: Props) {
  const pct = deliveryPct(delivered, goal);
  const isDone = goal > 0 && delivered >= goal;

  // Soma plays_7d mais recente por playlist
  const last7Growth = useMemo(() => {
    const latest = new Map<string, EcoSnap>();
    for (const s of snapshots) {
      if (!latest.has(s.managed_playlist_id)) latest.set(s.managed_playlist_id, s);
    }
    let total = 0;
    for (const s of latest.values()) total += Number(s.plays_7d ?? 0);
    return total;
  }, [snapshots]);

  const lastUpdate = snapshots[0]?.captured_at ?? null;
  const activePlaylists = allocations.filter(a =>
    a.status === "active" || a.status === "dispatched" || a.status === "done"
  ).length;

  // Status humano — espelha lógica do portal antigo
  const dailyAvg = daysElapsed > 0 ? delivered / daysElapsed : 0;
  const dailyGoal = daysTotal > 0 ? goal / daysTotal : 0;
  const ratio = dailyGoal > 0 ? dailyAvg / dailyGoal : 1;

  let statusLabel: string;
  let tone: "ok" | "warn" | "neutral";
  if (stage === "approval") {
    statusLabel = "Aguardando sua aprovação";
    tone = "neutral";
  } else if (stage === "rejected") {
    statusLabel = "Ajuste em análise";
    tone = "warn";
  } else if (isDone) {
    statusLabel = "Meta batida";
    tone = "ok";
  } else if (delivered === 0) {
    statusLabel = "Campanha iniciando";
    tone = "neutral";
  } else if (ratio >= 1.1) {
    statusLabel = "Campanha acelerando";
    tone = "ok";
  } else if (ratio >= 0.95) {
    statusLabel = "Entrega estável";
    tone = "ok";
  } else {
    statusLabel = "Entregando abaixo do ritmo esperado";
    tone = "warn";
  }

  const toneStyles = {
    ok:      { dot: "bg-primary",  text: "text-primary",  ring: "ring-primary/25",  bg: "bg-primary/[0.05]" },
    warn:    { dot: "bg-warning",  text: "text-warning",  ring: "ring-warning/25",  bg: "bg-warning/[0.05]" },
    neutral: { dot: "bg-muted-foreground", text: "text-muted-foreground", ring: "ring-border", bg: "bg-muted/30" },
  }[tone];

  return (
    <Card className="overflow-hidden border-border">
      <CardContent className="p-5 sm:p-6 space-y-5">
        {/* Topo: tag CAMPANHA + semáforo */}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
            Campanha
          </span>
          <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium", toneStyles.text)}>
            <span className="relative flex h-1.5 w-1.5">
              <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-75", toneStyles.dot, !isDone && stage === "live" && "animate-ping")} />
              <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", toneStyles.dot)} />
            </span>
            {statusLabel}
          </span>
        </div>

        {/* Identidade da música */}
        <div className="flex items-center gap-4">
          {camp.cover_url ? (
            <img src={camp.cover_url} alt={camp.track_name} className="w-[72px] h-[72px] rounded-xl object-cover ring-1 ring-border shrink-0" />
          ) : (
            <div className="w-[72px] h-[72px] rounded-xl bg-muted shrink-0 flex items-center justify-center ring-1 ring-border">
              <Music2 className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 mb-1">
              Música selecionada
            </div>
            <h2 className="text-[17px] sm:text-[18px] font-semibold leading-tight tracking-tight truncate">
              {camp.track_name}
            </h2>
            {camp.artist && (
              <p className="text-[12px] text-muted-foreground truncate mt-0.5">{camp.artist}</p>
            )}
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted/40 ring-1 ring-border px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums">
              <CalendarDays className="h-3 w-3 shrink-0 text-muted-foreground/80" />
              <span className="uppercase tracking-wider text-muted-foreground/70 text-[9px]">Janela</span>
              <span className="text-foreground/90">
                {formatShortDate(camp.started_at)} → {formatShortDate(camp.deadline)}
              </span>
            </div>
          </div>
        </div>

        {/* Hero: número grande só se a campanha tá rodando ou aprovada */}
        {stage === "live" && (
          <>
            <div className="h-px bg-border" />
            <div className={cn("rounded-xl p-4 ring-1", toneStyles.bg, toneStyles.ring)}>
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-[30px] sm:text-[36px] font-bold tabular-nums leading-none tracking-tight text-foreground">
                  {formatFull(delivered)}
                </span>
                <span className="text-[16px] sm:text-[18px] font-semibold tabular-nums text-muted-foreground leading-none">
                  / {formatFull(goal)}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Plays entregues desde o início da campanha
              </p>
              <div className="mt-3 h-1 rounded-full bg-background/40 overflow-hidden">
                <div className={cn("h-full rounded-full transition-all duration-500", toneStyles.dot)} style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3 flex-wrap">
                <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium", toneStyles.text)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", toneStyles.dot)} />
                  {statusLabel}
                </span>
                {last7Growth > 0 && (
                  <span className="text-[10.5px] uppercase tracking-wider inline-flex items-center gap-1 text-muted-foreground tabular-nums">
                    <TrendingUp className="h-3 w-3" />
                    +{formatPlays(last7Growth)} em 7d
                  </span>
                )}
              </div>
            </div>

            {/* Linha de rodapé: playlists ativas + última atualização */}
            <div className="flex items-center justify-between text-[11px] text-muted-foreground flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5">
                <ListMusic className="h-3.5 w-3.5" />
                <span className="text-foreground font-medium tabular-nums">{activePlaylists}</span> playlists ativas
              </span>
              {lastUpdate && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Atualizado {timeAgo(lastUpdate)}
                </span>
              )}
            </div>
          </>
        )}

        {/* CTA Spotify */}
        {camp.spotify_track_url && (
          <a href={camp.spotify_track_url} target="_blank" rel="noreferrer" className="block">
            <Button variant="outline" size="sm" className="w-full sm:w-auto">
              <ExternalLink className="h-4 w-4 mr-1.5" /> Ouvir no Spotify
            </Button>
          </a>
        )}
      </CardContent>
    </Card>
  );
}
