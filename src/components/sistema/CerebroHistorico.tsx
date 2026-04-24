// CerebroHistorico — lista das últimas execuções do autopilot, expandíveis,
// mostrando o pipeline completo (igual o painel do Cérebro, mas histórico).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Brain, CheckCircle2, AlertTriangle, Loader2, ChevronDown, ChevronUp,
  Sparkles, Clock,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import { STEP_LABELS, type AutopilotStep } from "@/hooks/useAutopilot";

const STEP_ORDER: AutopilotStep[] = [
  "analyze", "briefing", "blueprints", "templates", "covers", "approve", "replicate",
];

type Run = {
  id: string;
  genre_id: string;
  status: string;
  current_step: string | null;
  progress_pct: number;
  steps_completed: any[];
  templates_generated: number;
  templates_approved: number;
  covers_generated: number;
  cache_hits: Record<string, boolean>;
  summary: string | null;
  error_message: string | null;
  triggered_by: string;
  started_at: string;
  finished_at: string | null;
  duracao_ms: number | null;
};

function fmtDur(ms: number | null) {
  if (!ms) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${(s % 60).toString().padStart(2, "0")}s`;
}

export function CerebroHistorico() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [genres, setGenres] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [runsRes, gRes] = await Promise.all([
      supabase.from("autopilot_runs").select("*").order("started_at", { ascending: false }).limit(50),
      supabase.from("genres").select("id, nome"),
    ]);
    const map: Record<string, string> = {};
    (gRes.data ?? []).forEach((g: any) => { map[g.id] = g.nome; });
    setGenres(map);
    setRuns((runsRes.data ?? []) as Run[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`sistema-cerebro:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "autopilot_runs" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="nx-card p-6 flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando histórico…
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="nx-card p-8 text-center">
        <Brain className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Nenhuma execução do Cérebro registrada ainda.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Últimas <strong className="text-foreground">{runs.length}</strong> execuções da inteligência. Clique para expandir.
      </p>
      {runs.map((run) => {
        const isOpen = expanded.has(run.id);
        const isRunning = run.status === "running";
        const isError = run.status === "error";
        const isSuccess = run.status === "success";
        const Icon = isRunning ? Loader2 : isError ? AlertTriangle : CheckCircle2;
        const iconColor = isRunning ? "text-primary animate-spin" : isError ? "text-destructive" : "text-success";
        const borderColor = isRunning ? "border-primary/40" : isError ? "border-destructive/40" : "border-success/30";
        const completedSet = new Set(run.steps_completed?.map((s: any) => s.step) ?? []);
        const cacheCount = Object.values(run.cache_hits ?? {}).filter(Boolean).length;
        const genreNome = genres[run.genre_id] ?? "—";

        return (
          <div key={run.id} className={cn("nx-card border", borderColor)}>
            {/* Header clicável */}
            <button
              type="button"
              onClick={() => toggle(run.id)}
              className="w-full p-3 flex items-center gap-3 hover:bg-elevated/50 transition-colors text-left"
            >
              <Icon className={cn("h-4 w-4 shrink-0", iconColor)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">{genreNome}</span>
                  <Badge variant="outline" className="text-[10px] py-0 h-4">
                    {run.triggered_by === "manual" ? "manual" : "automático"}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    · {timeAgo(run.started_at)} · {fmtDur(run.duracao_ms)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {isRunning
                    ? `Rodando: ${STEP_LABELS[run.current_step as AutopilotStep] ?? "iniciando"}… (${run.progress_pct}%)`
                    : isError
                    ? `Falhou: ${run.error_message ?? "erro desconhecido"}`
                    : run.summary ?? "Concluído"}
                </p>
              </div>
              {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>

            {/* Conteúdo expandido */}
            {isOpen && (
              <div className="px-3 pb-3 space-y-3 border-t border-border/40 pt-3">
                {isRunning && <Progress value={run.progress_pct} className="h-1.5" />}

                {/* Counters */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Counter label="Templates gerados" value={run.templates_generated} />
                  <Counter label="Capas geradas" value={run.covers_generated} />
                  <Counter label="Aprovados" value={run.templates_approved} />
                  <Counter label="Cache reaproveitado" value={cacheCount} hint="etapas economizadas" />
                </div>

                {/* Etapas */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1.5">
                    Etapas do pipeline
                  </div>
                  <ol className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {STEP_ORDER.map((step) => {
                      const done = completedSet.has(step);
                      const active = run.current_step === step && isRunning;
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

                {isError && run.error_message && (
                  <div className="text-xs text-destructive bg-destructive/10 rounded p-2 border border-destructive/20">
                    <strong>Erro:</strong> {run.error_message}
                  </div>
                )}
                {isSuccess && run.summary && (
                  <div className="text-xs text-success/90 flex items-start gap-1.5">
                    <Sparkles className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>{run.summary}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Counter({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-2 py-1.5 rounded bg-card border border-border">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
      <span className="text-base font-bold tabular-nums text-foreground leading-none">{value ?? 0}</span>
      {hint && <span className="text-[9px] text-muted-foreground">{hint}</span>}
    </div>
  );
}
