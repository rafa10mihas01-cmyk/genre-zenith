// DiagnoseProgress — timeline operacional do "Rodar análise".
// UI-only: dirigido apenas pela prop `running`. Não chama edge function,
// não altera contrato, não toca Brain/Spotify/diagnose-managed-playlist.
// Tempos calibrados nas medianas reais medidas (ver Fase 7C.1).
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, AlertTriangle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Step = { id: string; label: string; ms: number };

// Medianas observadas (n=15, últimos 30 dias). load_current_tracks foi mesclado
// em "benchmark + current_tracks" porque é instantâneo (<150ms).
const STEPS: Step[] = [
  { id: "sync",       label: "Sincronizando faixas atuais com o Spotify",         ms: 1800 },
  { id: "benchmark",  label: "Carregando benchmark do nicho e concorrentes",      ms: 700  },
  { id: "spot_cur",   label: "Buscando metadados de faixas e artistas atuais",    ms: 800  },
  { id: "spot_cand",  label: "Avaliando candidatos para entrada",                 ms: 1200 },
  { id: "ai",         label: "Gerando plano editorial com IA",                    ms: 2400 },
  { id: "insights",   label: "Construindo recomendações e insights de mercado",   ms: 2200 },
  { id: "persist",    label: "Salvando diagnóstico",                              ms: 400  },
];

const TOTAL_MS = STEPS.reduce((a, s) => a + s.ms, 0); // ~9500ms
const SLOW_AT_MS = 14_000;
const DEGRADED_AT_MS = 30_000;
const FINISH_HOLD_MS = 1000;

type Phase = "hidden" | "running" | "finishing";

export function DiagnoseProgress({ running }: { running: boolean }) {
  const [phase, setPhase] = useState<Phase>("hidden");
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const finishTimerRef = useRef<number | null>(null);

  // Inicia / encerra o ciclo conforme `running` muda.
  useEffect(() => {
    if (running) {
      // Start
      if (finishTimerRef.current) { window.clearTimeout(finishTimerRef.current); finishTimerRef.current = null; }
      startedAtRef.current = performance.now();
      setElapsed(0);
      setPhase("running");
      const tick = () => {
        if (startedAtRef.current == null) return;
        setElapsed(performance.now() - startedAtRef.current);
        rafRef.current = window.requestAnimationFrame(tick);
      };
      rafRef.current = window.requestAnimationFrame(tick);
    } else if (phase === "running") {
      // Stop: marca tudo concluído, segura 1s e some.
      if (rafRef.current) { window.cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      setPhase("finishing");
      finishTimerRef.current = window.setTimeout(() => {
        setPhase("hidden");
        startedAtRef.current = null;
        setElapsed(0);
      }, FINISH_HOLD_MS);
    }
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  if (phase === "hidden") return null;

  // Calcula status por etapa.
  // Cap em 95% da última etapa enquanto `running`, pra nunca cravar 100% antes da resposta.
  const cappedElapsed = phase === "finishing"
    ? TOTAL_MS
    : Math.min(elapsed, TOTAL_MS * 0.95);

  let cum = 0;
  const stepStates = STEPS.map((s) => {
    const start = cum;
    const end = cum + s.ms;
    cum = end;
    let status: "done" | "active" | "pending" = "pending";
    let progress = 0;
    if (phase === "finishing" || cappedElapsed >= end) {
      status = "done";
      progress = 1;
    } else if (cappedElapsed >= start) {
      status = "active";
      progress = Math.min(1, (cappedElapsed - start) / s.ms);
    }
    return { ...s, status, progress };
  });

  const overallPct = Math.round((cappedElapsed / TOTAL_MS) * 100);
  const elapsedSec = (elapsed / 1000).toFixed(1);

  const slow = phase === "running" && elapsed > SLOW_AT_MS && elapsed <= DEGRADED_AT_MS;
  const degraded = phase === "running" && elapsed > DEGRADED_AT_MS;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card p-5 shadow-lg"
      role="status"
      aria-live="polite"
      aria-label="Progresso do diagnóstico"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {phase === "finishing" ? (
            <Check className="h-4 w-4 text-primary shrink-0" />
          ) : (
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
          )}
          <span className="text-sm font-semibold tracking-tight truncate">
            {phase === "finishing" ? "Diagnóstico concluído" : "Rodando análise"}
          </span>
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {elapsedSec}s · {phase === "finishing" ? 100 : overallPct}%
        </span>
      </div>

      {/* Barra geral */}
      <div className="h-1 w-full rounded-full bg-elevated overflow-hidden mb-4">
        <div
          className="h-full bg-primary transition-[width] duration-200 ease-out"
          style={{ width: `${phase === "finishing" ? 100 : overallPct}%` }}
        />
      </div>

      {/* Timeline */}
      <ol className="space-y-2.5">
        {stepStates.map((s) => (
          <li key={s.id} className="flex items-start gap-2.5 text-xs">
            <span
              className={cn(
                "mt-0.5 grid place-items-center h-4 w-4 rounded-full shrink-0 border",
                s.status === "done" && "bg-primary border-primary text-primary-foreground",
                s.status === "active" && "border-primary/60 text-primary",
                s.status === "pending" && "border-border text-muted-foreground/40",
              )}
            >
              {s.status === "done" ? (
                <Check className="h-2.5 w-2.5" />
              ) : s.status === "active" ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <span className="block h-1 w-1 rounded-full bg-current" />
              )}
            </span>
            <span
              className={cn(
                "leading-tight flex-1 min-w-0",
                s.status === "done" && "text-foreground/80",
                s.status === "active" && "text-foreground font-medium",
                s.status === "pending" && "text-muted-foreground/60",
              )}
            >
              {s.label}
              {s.status === "active" ? "…" : ""}
            </span>
          </li>
        ))}
      </ol>

      {/* Degradação */}
      {(slow || degraded) && (
        <div
          className={cn(
            "mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-snug",
            degraded
              ? "border-amber-500/30 bg-amber-500/5 text-amber-200"
              : "border-border bg-elevated text-muted-foreground",
          )}
        >
          <AlertTriangle className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", degraded ? "text-amber-400" : "text-muted-foreground")} />
          <span>
            {degraded
              ? "O Spotify ou a IA podem estar degradados. Aguarde."
              : "Análise demorando mais que o normal…"}
          </span>
        </div>
      )}
    </div>
  );
}
