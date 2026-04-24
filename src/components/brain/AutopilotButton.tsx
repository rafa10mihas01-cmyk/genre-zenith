// AutopilotButton — Botão "Usar inteligência" com progresso em tempo real.
// Executa o pipeline completo de um gênero em 1 clique.
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sparkles, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useAutopilot, STEP_LABELS } from "@/hooks/useAutopilot";
import { cn } from "@/lib/utils";

export function AutopilotButton({
  genreId,
  onComplete,
  size = "sm",
  maxTemplates = 5,
}: {
  genreId?: string | null;
  onComplete?: () => void;
  size?: "sm" | "default" | "lg";
  maxTemplates?: number;
}) {
  const { run, isRunning, starting, start } = useAutopilot(genreId ?? null);

  // 🐛 FIX: dispara onComplete APENAS UMA VEZ por run.id (não a cada render).
  // Bug anterior: queueMicrotask em todo render → onComplete → parent.load()
  // → re-render → microtask de novo → loop infinito de requests + piscamento.
  const lastNotifiedRunId = useRef<string | null>(null);
  useEffect(() => {
    if (
      run?.status === "success" &&
      run?.progress_pct === 100 &&
      run.id &&
      lastNotifiedRunId.current !== run.id &&
      onComplete
    ) {
      lastNotifiedRunId.current = run.id;
      onComplete();
    }
  }, [run?.id, run?.status, run?.progress_pct, onComplete]);


  // ── Estado: rodando ──────────────────────────────────────────
  if (run?.status === "running" || starting) {
    const stepLabel = run?.current_step ? STEP_LABELS[run.current_step] : "Iniciando";
    const pct = run?.progress_pct ?? 0;
    return (
      <div className="flex flex-col gap-1.5 min-w-[260px]">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5 text-foreground font-medium">
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
            {stepLabel}…
          </span>
          <span className="text-muted-foreground tabular-nums">{pct}%</span>
        </div>
        <Progress value={pct} className="h-1.5" />
        {(run?.templates_generated || run?.covers_generated) ? (
          <div className="text-[11px] text-muted-foreground">
            {run.templates_generated > 0 && <span>{run.templates_generated} templates</span>}
            {run.covers_generated > 0 && <span> · {run.covers_generated} capas</span>}
            {run.templates_approved > 0 && <span> · {run.templates_approved} aprovados</span>}
          </div>
        ) : null}
      </div>
    );
  }

  // ── Estado: erro recente (mas pode tentar de novo) ───────────
  if (run?.status === "error") {
    return (
      <div className="flex items-center gap-2">
        <Button
          size={size}
          variant="outline"
          onClick={() => start(maxTemplates)}
          disabled={!genreId}
          className="gap-1.5"
        >
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
          Tentar novamente
        </Button>
        {run.error_message && (
          <span className="text-[11px] text-destructive max-w-[280px] truncate" title={run.error_message}>
            {run.error_message}
          </span>
        )}
      </div>
    );
  }

  // ── Estado: sucesso recente ─────────────────────────────────
  const recentSuccess =
    run?.status === "success" &&
    run.finished_at &&
    Date.now() - new Date(run.finished_at).getTime() < 5 * 60 * 1000;

  // ── Estado: idle ────────────────────────────────────────────
  return (
    <div className="flex items-center gap-2">
      <Button
        size={size}
        variant="premium"
        onClick={() => start(maxTemplates)}
        disabled={!genreId || isRunning}
        className="gap-1.5"
      >
        <Sparkles className={cn("h-3.5 w-3.5", recentSuccess && "text-primary")} />
        {recentSuccess ? "Usar inteligência novamente" : "Usar inteligência"}
      </Button>
      {recentSuccess && (
        <span className="text-[11px] text-success flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {run.summary ?? "Concluído"}
        </span>
      )}
    </div>
  );
}
