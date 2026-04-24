// AoVivoPainel — centro de controle premium (estilo Stripe / Linear / Vercel).
// Substitui completamente a UI antiga da aba Ao Vivo.
// Composto por: StatusBar global + Pipeline animado (FluxoVisual) + MetricsGrid + Feed.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Zap, RefreshCw, Eye, FlaskConical, Loader2, CheckCircle2, AlertCircle, Sparkles, FileText, Image as ImageIcon, ListMusic, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { timeAgo } from "@/lib/format";
import { toast } from "sonner";
import { FluxoVisual } from "@/components/sistema/fluxo/FluxoVisual";
import { AoVivoFeed } from "@/components/sistema/AoVivoFeed";
import { RegrasVsExecucao } from "@/components/sistema/RegrasVsExecucao";

type LiveRun = {
  id: string;
  genreId: string;
  genreName: string;
  status: "running" | "success" | "error" | "partial";
  currentStep: string | null;
  progressPct: number;
  startedAt: string;
  finishedAt: string | null;
  templatesGenerated: number;
  templatesApproved: number;
  coversGenerated: number;
};

const STEP_LABEL: Record<string, string> = {
  analyze: "Cérebro · análise",
  briefing: "Cérebro · briefing",
  blueprints: "Cérebro · blueprints",
  templates: "Templates",
  covers: "Capas",
  publish: "Publicação",
  collect: "Coleta",
};

export function AoVivoPainel() {
  const [run, setRun] = useState<LiveRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);
  const [aggMetrics, setAggMetrics] = useState({
    templates: 0,
    aprovados: 0,
    capas: 0,
    eficiencia: 0,
  });

  const load = async () => {
    const { data: rRow } = await supabase
      .from("autopilot_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rRow) {
      const { data: g } = await supabase.from("genres").select("nome").eq("id", rRow.genre_id).maybeSingle();
      setRun({
        id: rRow.id,
        genreId: rRow.genre_id,
        genreName: g?.nome ?? "—",
        status: rRow.status as LiveRun["status"],
        currentStep: rRow.current_step,
        progressPct: rRow.progress_pct ?? 0,
        startedAt: rRow.started_at,
        finishedAt: rRow.finished_at,
        templatesGenerated: rRow.templates_generated ?? 0,
        templatesApproved: rRow.templates_approved ?? 0,
        coversGenerated: rRow.covers_generated ?? 0,
      });
    } else {
      setRun(null);
    }

    // Métricas agregadas das últimas 24h (todas as runs)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: runs24 } = await supabase
      .from("autopilot_runs")
      .select("templates_generated, templates_approved, covers_generated")
      .gte("started_at", since);
    const list = runs24 ?? [];
    const t = list.reduce((s, r: any) => s + (r.templates_generated ?? 0), 0);
    const a = list.reduce((s, r: any) => s + (r.templates_approved ?? 0), 0);
    const c = list.reduce((s, r: any) => s + (r.covers_generated ?? 0), 0);
    setAggMetrics({
      templates: t,
      aprovados: a,
      capas: c,
      eficiencia: t > 0 ? Math.round((a / t) * 100) : 0,
    });
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`aovivo:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "autopilot_runs" }, () => load())
      .subscribe();
    const t = setInterval(load, 15_000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, []);

  const isRunning = run?.status === "running";
  const isError = run?.status === "error";
  const stepLabel = run?.currentStep ? (STEP_LABEL[run.currentStep] ?? run.currentStep) : null;

  const onRerun = async (forceNoCache = false) => {
    if (!run) return;
    setRerunning(true);
    try {
      const { error } = await supabase.functions.invoke("autopilot-run", {
        body: { genre_id: run.genreId, force_no_cache: forceNoCache },
      });
      if (error) throw error;
      toast.success(forceNoCache ? "Re-execução sem cache iniciada" : "Re-execução iniciada");
      setTimeout(load, 1500);
    } catch (e: any) {
      toast.error("Falha ao iniciar", { description: e?.message ?? "Verifique os logs" });
    } finally {
      setRerunning(false);
    }
  };

  if (loading) {
    return (
      <div className="nx-card p-12 flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando painel ao vivo…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ============ STATUS BAR GLOBAL ============ */}
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border-2 p-4 sm:p-5",
          "bg-gradient-to-br from-card via-card to-elevated/40",
          isRunning && "border-warning/50 fluxo-active-glow",
          isError && "border-destructive/60 fluxo-error-glow",
          !isRunning && !isError && "border-success/30 fluxo-success-glow",
        )}
      >
        {/* Halo decorativo */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full blur-3xl opacity-30",
            isRunning && "bg-warning",
            isError && "bg-destructive",
            !isRunning && !isError && "bg-success",
          )}
        />

        <div className="relative flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6">
          {/* Status indicator + título */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className={cn(
                "h-12 w-12 rounded-xl flex items-center justify-center shrink-0",
                isRunning && "bg-warning/15",
                isError && "bg-destructive/15",
                !isRunning && !isError && "bg-success/15",
              )}
            >
              {isRunning ? (
                <Zap className="h-6 w-6 text-warning animate-pulse" />
              ) : isError ? (
                <AlertCircle className="h-6 w-6 text-destructive" />
              ) : (
                <CheckCircle2 className="h-6 w-6 text-success" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    isRunning && "bg-warning animate-pulse",
                    isError && "bg-destructive",
                    !isRunning && !isError && "bg-success",
                  )}
                />
                <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                  {isRunning ? "Sistema ativo · executando" : isError ? "Sistema com erro" : "Sistema ativo · ocioso"}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mt-0.5">
                <h2 className="text-lg sm:text-xl font-bold text-foreground leading-tight">
                  {run ? run.genreName : "Nenhuma execução"}
                </h2>
                {stepLabel && (
                  <>
                    <span className="text-muted-foreground/60 text-sm">→</span>
                    <span className={cn(
                      "text-sm font-semibold",
                      isRunning ? "text-warning" : "text-foreground/80",
                    )}>
                      {stepLabel}
                    </span>
                  </>
                )}
                {run && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    · {timeAgo(run.startedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Controles */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5"
              onClick={() => onRerun(false)}
              disabled={rerunning || !run || isRunning}
            >
              {rerunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Rodar de novo</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5"
              onClick={() => onRerun(true)}
              disabled={rerunning || !run || isRunning}
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sem cache</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-9 gap-1.5"
              onClick={() => {
                document.querySelector("#feed-ao-vivo")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <Eye className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logs completos</span>
            </Button>
          </div>
        </div>

        {/* Progresso */}
        {isRunning && run && (
          <div className="relative mt-4">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5 tabular-nums">
              <span className="flex items-center gap-1.5">
                <Activity className="h-3 w-3 text-warning animate-pulse" />
                Progresso geral
              </span>
              <span className="font-bold text-warning">{run.progressPct}%</span>
            </div>
            <Progress value={run.progressPct} className="h-2" />
          </div>
        )}
      </div>

      {/* ============ PIPELINE VISUAL ============ */}
      <FluxoVisual />

      {/* ============ MÉTRICAS KPI (últimas 24h) ============ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={FileText}
          label="Templates gerados"
          value={aggMetrics.templates}
          hint="últimas 24h"
          color="primary"
        />
        <KpiCard
          icon={Sparkles}
          label="Aprovados"
          value={aggMetrics.aprovados}
          hint={`${aggMetrics.templates > 0 ? Math.round((aggMetrics.aprovados / aggMetrics.templates) * 100) : 0}% do total`}
          color="success"
        />
        <KpiCard
          icon={ImageIcon}
          label="Capas"
          value={aggMetrics.capas}
          hint="geradas pela IA"
          color="warning"
        />
        <KpiCard
          icon={TrendingUp}
          label="Eficiência"
          value={`${aggMetrics.eficiencia}%`}
          hint="aprovação média"
          color={aggMetrics.eficiencia >= 60 ? "success" : aggMetrics.eficiencia >= 30 ? "warning" : "destructive"}
        />
      </div>

      {/* ============ REGRAS VS EXECUÇÃO (validação por gênero) ============ */}
      <RegrasVsExecucao />

      {/* ============ FEED AO VIVO ============ */}
      <div id="feed-ao-vivo" className="scroll-mt-4">
        <AoVivoFeed />
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  color,
}: {
  icon: any;
  label: string;
  value: string | number;
  hint?: string;
  color: "primary" | "success" | "warning" | "destructive";
}) {
  const colorMap = {
    primary: { bg: "bg-primary/10", border: "border-primary/20", icon: "text-primary", value: "text-foreground" },
    success: { bg: "bg-success/10", border: "border-success/20", icon: "text-success", value: "text-foreground" },
    warning: { bg: "bg-warning/10", border: "border-warning/20", icon: "text-warning", value: "text-foreground" },
    destructive: { bg: "bg-destructive/10", border: "border-destructive/20", icon: "text-destructive", value: "text-foreground" },
  };
  const c = colorMap[color];
  return (
    <div className={cn(
      "fluxo-node-hover relative overflow-hidden rounded-xl border p-4",
      "bg-gradient-to-br from-card to-elevated/30",
      c.border,
    )}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center", c.bg)}>
          <Icon className={cn("h-4 w-4", c.icon)} />
        </div>
      </div>
      <p className={cn("text-2xl font-bold tabular-nums leading-none", c.value)}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mt-2">{label}</p>
      {hint && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{hint}</p>}
    </div>
  );
}
