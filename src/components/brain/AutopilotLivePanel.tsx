// AutopilotLivePanel — painel persistente que mostra o progresso do pipeline
// genre-autopilot em TEMPO REAL: etapa atual, %, contadores, etapas concluídas
// e tempo decorrido. Aparece sempre que há uma run em andamento no gênero ativo
// (ou uma run finalizada nos últimos 5 minutos).
import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useAutopilot, STEP_LABELS, type AutopilotStep } from "@/hooks/useAutopilot";
import { cn } from "@/lib/utils";

const STEP_ORDER: AutopilotStep[] = [
  "analyze",
  "briefing",
  "blueprints",
  "templates",
  "covers",
  "approve",
  "replicate",
  "done",
];

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m${r.toString().padStart(2, "0")}s`;
}

export function AutopilotLivePanel({ genreId }: { genreId?: string | null }) {
  const { run } = useAutopilot(genreId ?? null);
  const [now, setNow] = useState(Date.now());
  const [collapsed, setCollapsed] = useState(false);
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);

  // Tick para tempo decorrido enquanto está rodando
  useEffect(() => {
    if (run?.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run?.status]);

  if (!run) return null;
  if (dismissedRunId === run.id) return null;

  const isRunning = run.status === "running";
  const isError = run.status === "error";
  const isSuccess = run.status === "success";
  const finishedRecently =
    isSuccess &&
    run.finished_at &&
    Date.now() - new Date(run.finished_at).getTime() < 5 * 60 * 1000;

  // Mostra apenas quando rodando, com erro, ou sucesso recente
  if (!isRunning && !isError && !finishedRecently) return null;

  const pct = run.progress_pct ?? 0;
  const elapsed = isRunning
    ? now - new Date(run.started_at).getTime()
    : run.duracao_ms ?? 0;

  const completedSet = new Set(run.steps_completed?.map((s) => s.step) ?? []);
  const currentStep = run.current_step;

  const headerColor = isError
    ? "border-destructive/40 bg-destructive/5"
    : isSuccess
    ? "border-success/40 bg-success/5"
    : "border-primary/40 bg-primary/5";

  const Icon = isError ? AlertTriangle : isSuccess ? CheckCircle2 : Loader2;
  const iconClass = isError
    ? "text-destructive"
    : isSuccess
    ? "text-success"
    : "text-primary animate-spin";

  const headlineText = isError
    ? "Falhou — veja o detalhe abaixo"
    : isSuccess
    ? "Concluído"
    : currentStep
    ? `${STEP_LABELS[currentStep]}…`
    : "Iniciando…";

  return (
    <div className={cn("nx-card border-2 p-4 space-y-3", headerColor)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <Icon className={cn("h-4 w-4 shrink-0", iconClass)} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-foreground">
                Inteligência {isRunning ? "rodando" : isError ? "com erro" : "finalizada"}
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                · {formatDuration(elapsed)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground truncate">{headlineText}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="text-sm font-bold tabular-nums text-foreground">{pct}%</span>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="p-1 rounded hover:bg-elevated text-muted-foreground"
            title={collapsed ? "Expandir" : "Recolher"}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          {!isRunning && (
            <button
              type="button"
              onClick={() => setDismissedRunId(run.id)}
              className="p-1 rounded hover:bg-elevated text-muted-foreground"
              title="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {isRunning && <Progress value={pct} className="h-2" />}

      {!collapsed && (
        <>
          {/* Counters */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Counter label="Templates" value={run.templates_generated} />
            <Counter label="Capas" value={run.covers_generated} />
            <Counter label="Aprovados" value={run.templates_approved} />
            <Counter
              label="Cache"
              value={Object.values(run.cache_hits ?? {}).filter(Boolean).length}
              hint="etapas reaproveitadas"
            />
          </div>

          {/* Step timeline */}
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
              Etapas
            </div>
            <ol className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {STEP_ORDER.filter((s) => s !== "done").map((step) => {
                const done = completedSet.has(step);
                const active = currentStep === step;
                return (
                  <li
                    key={step}
                    className={cn(
                      "flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border",
                      done && "border-success/30 bg-success/5 text-success",
                      active && "border-primary/40 bg-primary/10 text-primary font-medium",
                      !done && !active && "border-border text-muted-foreground",
                    )}
                  >
                    {done ? (
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                    ) : active ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                    ) : (
                      <span className="h-3 w-3 shrink-0 rounded-full border border-current" />
                    )}
                    <span className="truncate">{STEP_LABELS[step]}</span>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Error / Summary */}
          {isError && run.error_message && (
            <div className="text-xs text-destructive bg-destructive/10 rounded p-2 border border-destructive/20">
              <strong>Erro:</strong> {run.error_message}
            </div>
          )}
          {isSuccess && run.summary && (
            <div className="text-xs text-success/90 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" />
              {run.summary}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Counter({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-2 py-1.5 rounded bg-card border border-border">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </span>
      <span className="text-base font-bold tabular-nums text-foreground leading-none">
        {value ?? 0}
      </span>
      {hint && <span className="text-[9px] text-muted-foreground">{hint}</span>}
    </div>
  );
}
