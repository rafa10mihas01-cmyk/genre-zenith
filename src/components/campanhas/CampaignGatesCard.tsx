import { Check, Lock, Rocket, Loader2, CheckCircle2, Clock, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CollectionSourceBadge } from "@/components/campanhas/CollectionSourceBadge";
import { formatInt } from "@/lib/campaignEngine";

type GateState = "done" | "current" | "locked";

type StepProps = {
  title: string;
  state: GateState;
  meta?: string | null;
  badge?: React.ReactNode;
};

function Step({ title, state, meta, badge }: StepProps) {
  return (
    <div className="relative z-10 flex flex-col items-center text-center min-w-0 flex-1 px-2">
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center mb-3 shrink-0 transition-colors",
          state === "done" && "bg-primary text-primary-foreground",
          state === "current" && "bg-primary text-primary-foreground ring-4 ring-primary/20",
          state === "locked" && "bg-muted border border-border text-muted-foreground",
        )}
      >
        {state === "done" ? (
          <Check className="w-4 h-4" strokeWidth={3} />
        ) : state === "current" ? (
          <span className="w-2 h-2 rounded-full bg-primary-foreground animate-pulse" />
        ) : (
          <Lock className="w-3 h-3" />
        )}
      </div>
      <p
        className={cn(
          "text-xs font-semibold truncate max-w-full",
          state === "locked" ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {title}
      </p>
      {badge ? (
        <div className="mt-2">{badge}</div>
      ) : meta ? (
        <p
          className={cn(
            "text-[10px] mt-1 truncate max-w-full",
            state === "current" ? "text-primary" : "text-muted-foreground",
          )}
        >
          {meta}
        </p>
      ) : null}
    </div>
  );
}

export type CampaignGatesCardProps = {
  clientApprovedAt: string | null;
  planApprovedAt: string | null;
  /** Quando o plano foi congelado (snapshot_locked_at). */
  planFrozenAt?: string | null;
  ecoDispatchedAt: string | null;
  collectionMode?: string | null;
  status?: string | null;
  baselineReady?: boolean;
  baselineCollected?: number;
  baselineRequired?: number;
  baselineCapturedAt?: string | null;
  baselineTotalStreams?: number | null;
  baselinePlaylistsCount?: number | null;
  /** Streams já entregues — usado pra marcar a etapa final "Em entrega". */
  delivered?: number;
  onApprovePlan: () => void;
  onDispatch: () => void;
  approvingPlan: boolean;
  dispatching: boolean;
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function CampaignGatesCard({
  clientApprovedAt,
  planApprovedAt,
  planFrozenAt = null,
  ecoDispatchedAt,
  collectionMode,
  status,
  baselineReady = true,
  baselineCollected = 0,
  baselineRequired = 0,
  baselineCapturedAt = null,
  baselineTotalStreams = null,
  baselinePlaylistsCount = null,
  delivered = 0,
  onApprovePlan,
  onDispatch,
  approvingPlan,
  dispatching,
}: CampaignGatesCardProps) {
  const isSpreadsheet = collectionMode === "spreadsheet";
  const isLive = status === "active" || status === "paused";
  const isClosed = status === "completed" || status === "cancelled";

  const clientDone = !!clientApprovedAt || isLive || isClosed;
  const planDone = !!planApprovedAt || isClosed;
  // Plano congelado: snapshot_locked_at OU já tem dispatch/baseline (pré-requisito).
  const frozenDone =
    !!planFrozenAt || !!ecoDispatchedAt || !!baselineCapturedAt || isClosed;
  const baselineDone = baselineReady || isClosed;
  const dispatchDone =
    !!ecoDispatchedAt ||
    (isSpreadsheet && planDone && (isLive || isClosed)) ||
    status === "completed";
  const isAir = isLive || dispatchDone;
  // Ordem final dos Portões:
  // 1) Plano congelado → 2) Aprovação cliente → 3) Aprovação interna →
  // 4) Coleta baseline → 5) No ar
  const state1: GateState = frozenDone ? "done" : "current";
  const state2: GateState = clientDone ? "done" : frozenDone ? "current" : "locked";
  const state3: GateState = planDone ? "done" : clientDone ? "current" : "locked";
  const state4: GateState = baselineDone ? "done" : planDone ? "current" : "locked";
  const state5: GateState = isAir ? "done" : baselineDone ? "current" : "locked";

  // CTA visível: aprovar plano (gate 2) ou iniciar distribuição (gate 5).
  const nextAction: "plan" | "dispatch" | null = isClosed
    ? null
    : dispatchDone
      ? null
      : planDone
        ? isSpreadsheet || baselineReady
          ? "dispatch"
          : null
        : clientDone
          ? "plan"
          : null;

  // Header status pill.
  const headerStatus: { label: string; tone: "live" | "ok" | "wait" } = isClosed
    ? { label: "Encerrada", tone: "ok" }
    : isAir
      ? { label: "No ar", tone: "live" }
      : { label: "Em preparo", tone: "wait" };

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      {/* Header */}
      <div className="flex justify-between items-start gap-3 mb-8 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Portões da campanha
            </h3>
            {collectionMode ? <CollectionSourceBadge collectionMode={collectionMode} /> : null}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {isClosed
              ? "Campanha encerrada."
              : isLive
                ? isSpreadsheet
                  ? "Cliente envia atualizações via planilha no portal."
                  : "Coleta automática rodando nas playlists."
                : nextAction === "dispatch"
                  ? "Baseline capturada. Falta colocar a campanha no ar."
                  : nextAction === "plan"
                    ? "Cliente aprovou. Falta a aprovação interna."
                    : planDone && !isSpreadsheet && !baselineReady
                      ? `Aguardando baseline: ${baselineCollected}/${baselineRequired} playlist(s).`
                      : "Aguardando aprovação do cliente."}
          </p>
        </div>
        <div
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium shrink-0",
            headerStatus.tone === "live" && "text-primary",
            headerStatus.tone === "ok" && "text-primary",
            headerStatus.tone === "wait" && "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              headerStatus.tone === "live" && "bg-primary animate-pulse",
              headerStatus.tone === "ok" && "bg-primary",
              headerStatus.tone === "wait" && "bg-muted-foreground",
            )}
          />
          {headerStatus.label}
        </div>
      </div>

      {/* Pipeline — 5 etapas, régua única, fecha em "No ar" */}
      <div className="relative flex justify-between items-start">
        {/* Conector base (cinza) */}
        <div className="absolute top-4 left-[8%] right-[8%] h-[2px] bg-border z-0" />
        {/* Conector preenchido (verde) — proporcional aos 4 segmentos entre os 5 nós */}
        <div
          className="absolute top-4 left-[8%] h-[2px] bg-primary z-0 transition-all"
          style={{
            width: `${(Math.max([state1, state2, state3, state4, state5].filter((s) => s === "done").length - 1, 0) / 4 * 84).toFixed(2)}%`,
          }}
        />

        <Step
          title="Plano congelado"
          state={state1}
          meta={
            planFrozenAt
              ? `há ${relTime(planFrozenAt)} — ${fmtShort(planFrozenAt)}`
              : frozenDone
                ? "Congelado"
                : "Primeiro portão"
          }
        />
        <Step
          title="Aprovação cliente"
          state={state2}
          meta={
            clientApprovedAt
              ? `há ${relTime(clientApprovedAt)} — ${fmtShort(clientApprovedAt)}`
              : isLive
                ? "Concluído"
                : frozenDone
                  ? "Aguardando"
                  : "Bloqueado"
          }
        />
        <Step
          title="Aprovação interna"
          state={state3}
          meta={
            planApprovedAt
              ? `há ${relTime(planApprovedAt)} — ${fmtShort(planApprovedAt)}`
              : planDone
                ? "Aprovado"
                : clientDone
                  ? "Próximo passo"
                  : "Bloqueado"
          }
        />
        <Step
          title="Baseline capturada"
          state={state4}
          meta={
            baselineDone
              ? baselineCapturedAt
                ? `há ${relTime(baselineCapturedAt)}`
                : "Capturada"
              : frozenDone
                ? `${baselineCollected}/${baselineRequired || "—"}`
                : "Bloqueado"
          }
          badge={
            baselineDone && (baselineTotalStreams || baselinePlaylistsCount) ? (
              <div className="px-2 py-1 rounded-md bg-background border border-border tabular-nums">
                {baselineTotalStreams ? (
                  <div className="text-[9px] font-bold text-foreground">
                    {compact(baselineTotalStreams)} streams
                  </div>
                ) : null}
                {baselinePlaylistsCount ? (
                  <div className="text-[8px] text-muted-foreground">
                    {formatInt(baselinePlaylistsCount)} playlists
                  </div>
                ) : null}
              </div>
            ) : null
          }
        />
        <Step
          title={isSpreadsheet ? "Coleta Excel" : "Coleta Spotify"}
          state={state5}
          meta={
            ecoDispatchedAt
              ? `há ${relTime(ecoDispatchedAt)}`
              : isSpreadsheet && (isLive || isClosed)
                ? "Recebendo planilhas"
                : dispatchDone
                  ? "Rodando"
                  : state5 === "current"
                    ? "Ativa agora"
                    : "Bloqueado"
          }
        />
        <Step
          title="No ar"
          state={state6}
          meta={
            isClosed
              ? "Encerrada"
              : isAir
                ? "Ativa"
                : dispatchDone
                  ? "Subindo"
                  : "Aguardando"
          }
        />
      </div>

      {/* CTA */}
      {nextAction ? (
        <div className="mt-6 pt-4 border-t border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {nextAction === "dispatch"
                ? "A inserção começa no próximo ciclo (~1min)."
                : "Aprovar plano cria o deal do curador e libera os próximos passos."}
            </span>
          </div>
          {nextAction === "plan" ? (
            <Button
              size="sm"
              onClick={onApprovePlan}
              disabled={approvingPlan}
              className="h-9 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {approvingPlan ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Aprovar plano interno
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onDispatch}
              disabled={dispatching}
              className="h-9 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {dispatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Iniciar distribuição
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 60) return `${m}min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".0", "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(".0", "")}k`;
  return String(n);
}
