// PlanTab — refatorado na Fase 7D / D2.
// Aplica TabShell: Banner → KPIs → Primary (buckets + CTA único) → Secondary (projeção + histórico).
// Reaproveita PlanStatusBand (status do banner), EditorialBanner (modo/cooldown), todos os buckets.
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, Check, Loader2, ShieldCheck, Sparkles, Timer, Activity,
  TrendingUp, TrendingDown, Minus, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ProjecaoFaixa } from "@/components/operacao/SimuladorEntrega";
import { AdjustmentTimeline } from "@/components/playlists/cockpit/AdjustmentTimeline";
import { SectionTitle } from "../shared/SectionTitle";
import { BucketRemove } from "../shared/BucketRemove";
import { BucketReorder } from "../shared/BucketReorder";
import { BucketAdd } from "../shared/BucketAdd";
import { EditorialBanner } from "../shared/EditorialBanner";
import { PlanImpactCard } from "../shared/PlanImpactCard";
import { computePlanImpact } from "../shared/computePlanImpact";
import { TabShell } from "../shared/ds/TabShell";
import { TabContextBanner } from "../shared/ds/TabContextBanner";
import { TabKpiStrip } from "../shared/ds/TabKpiStrip";
import { KpiCard } from "../shared/ds/KpiCard";
import { SecondarySection } from "../shared/ds/SecondarySection";
import { useCockpit } from "../context/CockpitContext";
import { usePlaylistBrain, type PlaylistBrain } from "@/hooks/usePlaylistBrain";
import { Badge } from "@/components/ui/badge";

function ageLabel(iso?: string | null) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor(ms / 3_600_000);
  if (d >= 1) return d === 1 ? "1 dia" : `${d} dias`;
  if (h >= 1) return h === 1 ? "1 hora" : `${h} horas`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min`;
}

function trendMeta(t: PlaylistBrain["health_trend"]) {
  switch (t) {
    case "crescendo": return { label: "Crescendo", Icon: TrendingUp, tone: "text-primary" };
    case "encolhendo": return { label: "Encolhendo", Icon: TrendingDown, tone: "text-destructive" };
    case "estavel": return { label: "Estável", Icon: Minus, tone: "text-muted-foreground" };
    case "novo": return { label: "Recente", Icon: Sparkles, tone: "text-muted-foreground" };
    default: return { label: "Sem dados", Icon: Minus, tone: "text-muted-foreground/60" };
  }
}

function confidenceTone(c: number) {
  if (c >= 75) return "text-primary";
  if (c >= 50) return "text-foreground";
  if (c >= 25) return "text-warning";
  return "text-destructive";
}

export function PlanTab() {
  const {
    diag, buckets, applying, applyProgress, applyPlan,
    runDiagnose, running, liveTracksCount,
    managedId, playlistName, coverUrl, followers,
    canonicalPlaylistId,
  } = useCockpit();
  if (!diag) return null;

  const { data: brain } = usePlaylistBrain(canonicalPlaylistId ?? undefined);
  const confidence = brain?.confidence_score ?? null;
  const trend = brain?.health_trend ?? "sem_dados";
  const tMeta = trendMeta(trend);
  const TIcon = tMeta.Icon;
  const age = ageLabel(diag?.created_at);
  const highSignals = (brain?.signals ?? []).filter((s) => s.severity === "high");
  const medSignals = (brain?.signals ?? []).filter((s) => s.severity === "medium");
  const visibleSignals = [...highSignals, ...medSignals].slice(0, 4);
  const remainingSignals = (brain?.signals?.length ?? 0) - visibleSignals.length;

  const mode = diag.raw?.recommendation_mode ?? "light";
  const total = buckets.remove.length + buckets.demote.length + buckets.promote.length + buckets.add.length;
  const detectedTotal = buckets.detected.remove + buckets.detected.demote + buckets.detected.promote + buckets.detected.add;

  // ===== BANNER =====
  const bannerStatus = (
    <>
      {confidence != null && (
        <div className="flex items-center gap-1.5">
          <ShieldCheck className={cn("h-3.5 w-3.5", confidenceTone(confidence))} />
          <span className="text-muted-foreground">Confiança</span>
          <span className={cn("tabular-nums font-medium", confidenceTone(confidence))}>
            {Math.round(confidence)}%
          </span>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <TIcon className={cn("h-3.5 w-3.5", tMeta.tone)} />
        <span className="text-muted-foreground">Tendência</span>
        <span className={cn("font-medium", tMeta.tone)}>{tMeta.label}</span>
      </div>
      {age && (
        <div className="flex items-center gap-1.5">
          <Timer className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Última análise</span>
          <span className="font-medium text-foreground">{age} atrás</span>
        </div>
      )}
      {visibleSignals.length > 0 ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Sinais</span>
          <div className="flex flex-wrap gap-1">
            {visibleSignals.map((s) => (
              <Badge
                key={s.code}
                variant="outline"
                title={s.message}
                className={cn(
                  "h-5 px-1.5 text-[10px] font-medium gap-1",
                  s.severity === "high"
                    ? "border-destructive/40 text-destructive bg-destructive/5"
                    : "border-warning/40 text-warning bg-warning/5",
                )}
              >
                {s.severity === "high" && <AlertTriangle className="h-2.5 w-2.5" />}
                {s.message}
              </Badge>
            ))}
            {remainingSignals > 0 && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                +{remainingSignals}
              </Badge>
            )}
          </div>
        </div>
      ) : brain ? (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          Sem alertas
        </div>
      ) : null}
    </>
  );

  const bannerAction = (
    <Button
      size="sm"
      variant="outline"
      onClick={runDiagnose}
      disabled={running}
      className="gap-1.5 h-8 rounded-full text-xs"
    >
      {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
      Rediagnosticar
    </Button>
  );

  return (
    <TabShell
      banner={
        <TabContextBanner
          title="Plano de ação"
          subtitle="Execute as alterações sugeridas para aproximar a playlist do benchmark."
          status={bannerStatus}
          action={bannerAction}
        />
      }
      kpis={
        <TabKpiStrip>
          <KpiCard
            label="Remover"
            value={buckets.remove.length}
            hint={buckets.detected.remove > buckets.remove.length
              ? `de ${buckets.detected.remove} detectadas`
              : "faixas fora do padrão"}
            tone={buckets.remove.length > 0 ? "destructive" : "muted"}
          />
          <KpiCard
            label="Mover"
            value={buckets.demote.length}
            hint={buckets.detected.demote > buckets.demote.length
              ? `de ${buckets.detected.demote} detectadas`
              : "rebaixar posição"}
            tone={buckets.demote.length > 0 ? "warning" : "muted"}
          />
          <KpiCard
            label="Promover"
            value={buckets.promote.length}
            hint={buckets.detected.promote > buckets.promote.length
              ? `de ${buckets.detected.promote} detectadas`
              : "subir posição"}
            tone={buckets.promote.length > 0 ? "primary" : "muted"}
          />
          <KpiCard
            label="Adicionar"
            value={buckets.add.length}
            hint={buckets.detected.add > buckets.add.length
              ? `de ${buckets.detected.add} sugeridas`
              : "novas faixas"}
            tone={buckets.add.length > 0 ? "primary" : "muted"}
          />
        </TabKpiStrip>
      }
      primary={
        <div className="space-y-4">
          {/* Modo editorial (cooldown / caps) — só se há contexto relevante */}
          <EditorialBanner diag={diag} onRediagnose={runDiagnose} running={running} />

          {/* Estados vazios canônicos */}
          {mode === "hold" && (
            <Card className="p-5 border-primary/30 bg-primary/5">
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <div className="text-sm font-semibold">Não mexer agora</div>
                  <div className="text-xs text-muted-foreground leading-relaxed">
                    O cérebro analisou essa playlist e decidiu que ela está performando bem — qualquer mexida agora atrapalha mais do que ajuda.
                    {detectedTotal > 0 && <> Existem <span className="text-foreground font-semibold">{detectedTotal}</span> ajustes possíveis, mas estão segurados nesse ciclo.</>}
                    {" "}Volte depois de 7 dias ou clique em <strong className="text-foreground">Rediagnosticar</strong> se algo mudou.
                  </div>
                </div>
              </div>
            </Card>
          )}
          {mode !== "hold" && total === 0 && detectedTotal === 0 && (
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-success shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <div className="text-sm font-semibold">Nada a fazer</div>
                  <div className="text-xs text-muted-foreground">Nenhuma faixa fora do padrão nem sugestão pra adicionar agora.</div>
                </div>
              </div>
            </Card>
          )}

          {/* Ações na ordem (Primary dominante) */}
          {total > 0 && (
            <section className="space-y-3">
              <SectionTitle>Ações na ordem</SectionTitle>

              <BucketRemove
                items={buckets.remove}
                applying={applying === "remove" || applying === "all"}
                onApplyAll={() => applyPlan("remove")}
              />
              <BucketReorder
                kind="demote"
                items={buckets.demote}
                totalTracks={liveTracksCount}
                applying={applying === "demote" || applying === "all"}
                onApplyAll={() => applyPlan("demote")}
              />
              <BucketReorder
                kind="promote"
                items={buckets.promote}
                totalTracks={liveTracksCount}
                applying={applying === "promote" || applying === "all"}
                onApplyAll={() => applyPlan("promote")}
              />
              <BucketAdd
                items={buckets.add}
                applying={applying === "add" || applying === "all"}
                onApplyAll={() => applyPlan("add")}
              />

              {/* Progresso de aplicação */}
              {applyProgress && (
                <Card className={cn(
                  "p-4 space-y-2 border",
                  applyProgress.status === "failed"
                    ? "bg-destructive/5 border-destructive/40"
                    : "bg-primary/5 border-primary/30",
                )}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {applyProgress.status === "failed" ? (
                        <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                      ) : applyProgress.status === "done" || applyProgress.status === "skipped" ? (
                        <Check className="h-4 w-4 text-primary shrink-0" />
                      ) : (
                        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{applyProgress.description}</div>
                        {applyProgress.error && (
                          <div className="text-xs text-destructive mt-0.5 truncate">{applyProgress.error}</div>
                        )}
                      </div>
                    </div>
                    <div className="text-xs font-mono text-muted-foreground shrink-0">
                      {applyProgress.index} / {applyProgress.total}
                    </div>
                  </div>
                  {applyProgress.total > 0 && (
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full transition-all duration-300",
                          applyProgress.status === "failed" ? "bg-destructive" : "bg-primary",
                        )}
                        style={{ width: `${Math.min(100, (applyProgress.index / applyProgress.total) * 100)}%` }}
                      />
                    </div>
                  )}
                </Card>
              )}

              {/* Impacto esperado — projeção pré-execução (Fase 8.1) */}
              <PlanImpactCard />

              {/* CTA único — footer da seção Ações */}
              <Card className="p-4 md:p-5 bg-primary/5 border-primary/30 flex flex-col items-center text-center gap-3 md:flex-row md:items-center md:text-left md:justify-between">

                <div className="space-y-0.5 min-w-0">
                  <div className="text-sm font-semibold">Aprovar e executar tudo</div>
                  <div className="text-[11px] text-muted-foreground">
                    Aplica remoções, movimentações e adições via API do Spotify.
                  </div>
                </div>
                <Button
                  onClick={() => applyPlan("all")}
                  disabled={applying !== null}
                  size="sm"
                  className="gap-1.5 h-9 px-5 rounded-full text-sm font-medium shrink-0"
                >
                  {applying === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Aprovar e executar
                </Button>
              </Card>
            </section>
          )}
        </div>
      }
      secondary={
        <>
          {buckets.add.length > 0 && (
            <SecondarySection title="Projeção de plays por posição">
              <ProjecaoFaixa
                playlist={{
                  id: managedId,
                  name: playlistName,
                  cover_url: coverUrl,
                  followers: followers ?? 0,
                  tracks_count: liveTracksCount,
                }}
              />
            </SecondarySection>
          )}
          <SecondarySection title="Histórico de ajustes">
            <AdjustmentTimeline playlistId={managedId} />
          </SecondarySection>
        </>
      }
    />
  );
}
