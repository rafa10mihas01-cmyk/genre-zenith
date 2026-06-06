// PlanTab — extraído 1:1 do PlaylistCockpit.tsx (Fase 2 / Commit 5).
// Concentra os 4 buckets + diagnóstico editorial + progresso + histórico.
// Nenhuma classe Tailwind, ordem, copy ou lógica foi alterada.
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle, Check, ChevronDown, Loader2, ShieldCheck, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ProjecaoFaixa } from "@/components/operacao/SimuladorEntrega";
import { AdjustmentTimeline } from "@/components/playlists/cockpit/AdjustmentTimeline";
import { SectionTitle } from "../shared/SectionTitle";
import { ActionCard } from "../shared/ActionCard";
import { BucketRemove } from "../shared/BucketRemove";
import { BucketReorder } from "../shared/BucketReorder";
import { BucketAdd } from "../shared/BucketAdd";
import { EditorialBanner } from "../shared/EditorialBanner";
import { useCockpit } from "../context/CockpitContext";

export function PlanTab() {
  const {
    diag, buckets, applying, applyProgress, applyPlan,
    runDiagnose, running, liveTracksCount,
    managedId, playlistName, coverUrl, followers,
  } = useCockpit();
  if (!diag) return null;

  return (
    <>
      {/* ===== 1. VISÃO GERAL ===== */}
      <section className="space-y-3">
        <SectionTitle>Visão geral</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <ActionCard kind="remove" count={buckets.remove.length} detected={buckets.detected.remove} hrefId="bucket-remove" />
          <ActionCard kind="demote" count={buckets.demote.length} detected={buckets.detected.demote} hrefId="bucket-demote" />
          <ActionCard kind="promote" count={buckets.promote.length} detected={buckets.detected.promote} hrefId="bucket-promote" />
          <ActionCard kind="add" count={buckets.add.length} detected={buckets.detected.add} hrefId="bucket-add" />
        </div>
      </section>

      {/* ===== 2. DIAGNÓSTICO ===== */}
      <section className="space-y-3">
        <SectionTitle>Diagnóstico</SectionTitle>
        <EditorialBanner diag={diag} onRediagnose={runDiagnose} running={running} />
        {(() => {
          const mode = diag.raw?.recommendation_mode ?? "light";
          const total = buckets.remove.length + buckets.demote.length + buckets.promote.length + buckets.add.length;
          const detectedTotal = buckets.detected.remove + buckets.detected.demote + buckets.detected.promote + buckets.detected.add;
          if (mode === "hold") {
            return (
              <Card className="p-5 border-primary/30 bg-primary/5">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div className="space-y-1 min-w-0">
                    <div className="text-sm font-semibold">Não mexer agora</div>
                    <div className="text-xs text-muted-foreground leading-relaxed">
                      O cérebro analisou essa playlist e decidiu que ela está performando bem — qualquer mexida agora atrapalha mais do que ajuda.
                      {detectedTotal > 0 && <> Existem <span className="text-foreground font-semibold">{detectedTotal}</span> ajustes possíveis, mas estão segurados nesse ciclo.</>}
                      {" "}Volte depois de 7 dias ou clique em <strong className="text-foreground">Reavaliar</strong> se algo mudou.
                    </div>
                  </div>
                </div>
              </Card>
            );
          }
          if (total === 0 && detectedTotal === 0) {
            return (
              <Card className="p-5">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="h-5 w-5 text-success shrink-0 mt-0.5" />
                  <div className="space-y-1 min-w-0">
                    <div className="text-sm font-semibold">Nada a fazer</div>
                    <div className="text-xs text-muted-foreground">Nenhuma faixa fora do padrão nem sugestão pra adicionar agora.</div>
                  </div>
                </div>
              </Card>
            );
          }
          return null;
        })()}
      </section>

      {/* ===== 3. EXECUTAR PLANO ===== */}
      {(buckets.remove.length + buckets.demote.length + buckets.promote.length + buckets.add.length) > 0 && (
        <Card className="p-4 md:p-5 bg-primary/5 border-primary/30 flex flex-col items-center text-center gap-3 md:flex-row md:items-center md:text-left md:justify-between">
          <div className="space-y-0.5 min-w-0">
            <div className="text-sm font-semibold">Executar plano</div>
            <div className="text-[11px] text-muted-foreground">
              Aplica tudo via API.
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
      )}

      <section className="space-y-3">

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
                  <div className="text-sm font-medium truncate">
                    {applyProgress.description}
                  </div>
                  {applyProgress.error && (
                    <div className="text-xs text-destructive mt-0.5 truncate">
                      {applyProgress.error}
                    </div>
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
      </section>

      {/* ===== 3. AÇÕES (sequência canônica) ===== */}
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
        {/* Projeção de plays — contexto pra decidir posição das novas faixas. Colapsado. */}
        {buckets.add.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5 px-2 py-1.5 rounded border border-border hover:border-primary/40">
              <ChevronDown className="h-3 w-3" /> Ver projeção de plays por posição
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <ProjecaoFaixa
                playlist={{
                  id: managedId,
                  name: playlistName,
                  cover_url: coverUrl,
                  followers: followers ?? 0,
                  tracks_count: liveTracksCount,
                }}
              />
            </CollapsibleContent>
          </Collapsible>
        )}
        <BucketAdd
          items={buckets.add}
          applying={applying === "add" || applying === "all"}
          onApplyAll={() => applyPlan("add")}
        />
      </section>

      {/* ===== 4. HISTÓRICO ===== */}
      <section className="space-y-3">
        <SectionTitle>Histórico</SectionTitle>
        <AdjustmentTimeline playlistId={managedId} />
      </section>
    </>
  );
}
