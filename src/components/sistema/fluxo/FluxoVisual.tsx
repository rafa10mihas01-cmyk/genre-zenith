// FluxoVisual — orquestrador do painel de fluxo (estilo n8n).
// Carrega run, logs, ajustes e estatísticas reais; monta 7 nós conectados;
// abre drawer ao clicar; suporta replay de execuções passadas.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, History, Zap, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { timeAgo } from "@/lib/format";
import { FluxoNode } from "./FluxoNode";
import { FluxoConnector } from "./FluxoConnector";
import { FluxoNodeDrawer } from "./FluxoNodeDrawer";
import { FluxoCriticalAlerts, extractCriticalAlerts } from "./FluxoCriticalAlerts";
import { buildFluxoNodes } from "./buildFluxo";
import type { FluxoNodeData, FluxoRun } from "./types";

type RunOption = {
  id: string;
  genreId: string;
  genreName: string;
  status: string;
  startedAt: string;
};

function mapRun(r: any, genreName: string): FluxoRun {
  return {
    id: r.id,
    genreId: r.genre_id,
    genreName,
    status: r.status,
    currentStep: r.current_step,
    progressPct: r.progress_pct ?? 0,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duracao_ms,
    triggeredBy: r.triggered_by,
    templatesGenerated: r.templates_generated ?? 0,
    templatesApproved: r.templates_approved ?? 0,
    coversGenerated: r.covers_generated ?? 0,
    cacheHits: r.cache_hits ?? {},
    stepsCompleted: r.steps_completed ?? [],
    summary: r.summary,
    errorMessage: r.error_message,
  };
}

export function FluxoVisual({ compact = false }: { compact?: boolean }) {
  const [runs, setRuns] = useState<RunOption[]>([]);
  const [genres, setGenres] = useState<Record<string, string>>({});
  const [selectedRunId, setSelectedRunId] = useState<string>("live");
  const [run, setRun] = useState<FluxoRun | null>(null);
  const [nodes, setNodes] = useState<FluxoNodeData[]>([]);
  const [selectedNode, setSelectedNode] = useState<FluxoNodeData | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Carregar gêneros + lista de runs disponíveis
  useEffect(() => {
    (async () => {
      const [g, r] = await Promise.all([
        supabase.from("genres").select("id, nome"),
        supabase.from("autopilot_runs").select("id, genre_id, status, started_at").order("started_at", { ascending: false }).limit(50),
      ]);
      const gMap: Record<string, string> = {};
      (g.data ?? []).forEach((x: any) => { gMap[x.id] = x.nome; });
      setGenres(gMap);
      setRuns((r.data ?? []).map((x: any) => ({
        id: x.id,
        genreId: x.genre_id,
        genreName: gMap[x.genre_id] ?? "—",
        status: x.status,
        startedAt: x.started_at,
      })));
    })();
  }, []);

  // Carregar dados do fluxo (run selecionada + logs + stats)
  const loadFluxo = async () => {
    let runRow: any = null;
    if (selectedRunId === "live") {
      const { data } = await supabase
        .from("autopilot_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      runRow = data;
    } else {
      const { data } = await supabase
        .from("autopilot_runs")
        .select("*")
        .eq("id", selectedRunId)
        .maybeSingle();
      runRow = data;
    }

    const fluxoRun = runRow ? mapRun(runRow, genres[runRow.genre_id] ?? "—") : null;
    setRun(fluxoRun);

    // Janela de tempo: para "live", últimas 24h; para replay, ±2h da execução
    let since: string;
    let until: string | null = null;
    if (fluxoRun && selectedRunId !== "live") {
      const start = new Date(fluxoRun.startedAt).getTime();
      since = new Date(start - 30 * 60 * 1000).toISOString(); // -30min
      until = new Date(start + 4 * 60 * 60 * 1000).toISOString(); // +4h
    } else {
      since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    }

    // Uma única chamada agrega logs/searchStats/genreFilter etc.
    const { data: stats, error: statsErr } = await supabase.functions.invoke("get-sistema-stats", {
      body: {
        genre_id: fluxoRun?.genreId ?? null,
        run_id:   selectedRunId === "live" ? null : selectedRunId,
        since,
        until,
      },
    });
    if (statsErr) {
      console.error("[FluxoVisual] get-sistema-stats falhou:", statsErr);
      setLoading(false);
      return;
    }

    const sr = stats?.searchStats ?? { total: 0, valid: 0, invalid: 0, avgFollowersValid: null };

    // Stats novos do pipeline atual (catálogo / deal / execução)
    const todayISO = new Date(); todayISO.setHours(0, 0, 0, 0);
    const dayAgoISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [catTotal, catActive, dealsActive, songsPending, jobsAgg] = await Promise.all([
      supabase.from("managed_playlists").select("id", { count: "exact", head: true }),
      supabase.from("managed_playlists").select("id", { count: "exact", head: true }).is("archived_at", null),
      supabase.from("curator_deals").select("id", { count: "exact", head: true }).is("closed_at", null),
      supabase.from("curator_deal_songs").select("id", { count: "exact", head: true }).is("ends_at", null),
      supabase.from("playlist_execution_jobs").select("status, completed_at, created_at").gte("created_at", dayAgoISO).limit(5000),
    ]);

    const jobsRows = (jobsAgg.data ?? []) as Array<{ status: string; completed_at: string | null }>;
    const execStat = {
      pending:   jobsRows.filter((j) => j.status === "pending").length,
      claimed:   jobsRows.filter((j) => j.status === "claimed").length,
      doneToday: jobsRows.filter((j) => j.status === "done" && j.completed_at && new Date(j.completed_at) >= todayISO).length,
      failed24h: jobsRows.filter((j) => j.status === "failed").length,
    };

    const built = buildFluxoNodes({
      run: fluxoRun,
      logs: stats?.logs ?? [],
      searchStats: {
        termsCount:        stats?.termsCount ?? 0,
        rawPlaylists:      sr.total,
        validPlaylists:    sr.valid,
        invalidPlaylists:  sr.invalid,
        avgFollowersValid: sr.avgFollowersValid,
      },
      apifyBlocked: {
        blocked: stats?.systemFlags?.apify_blocked ?? false,
        reason:  stats?.systemFlags?.apify_blocked_reason ?? undefined,
      },
      genreFilter: stats?.genreFilter ?? null,
      catalogStat: { total: catTotal.count ?? 0, active: catActive.count ?? 0 },
      dealStat: { activeDeals: dealsActive.count ?? 0, pendingSongs: songsPending.count ?? 0, dueToday: 0 },
      execStat,
    });
    setNodes(built);
    setLoading(false);
  };

  useEffect(() => {
    if (Object.keys(genres).length === 0) return;
    loadFluxo();
    if (selectedRunId === "live") {
      const ch = supabase
        .channel(`fluxo:${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "autopilot_runs" }, () => loadFluxo())
        .on("postgres_changes", { event: "*", schema: "public", table: "collection_logs" }, () => loadFluxo())
        .on("postgres_changes", { event: "*", schema: "public", table: "search_results" }, () => loadFluxo())
        .subscribe();
      const t = setInterval(loadFluxo, 15_000);
      return () => { supabase.removeChannel(ch); clearInterval(t); };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunId, genres]);

  const isLive = selectedRunId === "live";
  const isRunning = run?.status === "running";

  const openDrawer = (n: FluxoNodeData) => {
    setSelectedNode(n);
    setDrawerOpen(true);
  };

  const focusNodeById = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (n) openDrawer(n);
  };

  const criticalAlerts = useMemo(() => extractCriticalAlerts(nodes), [nodes]);

  if (loading) {
    return (
      <div className="nx-card p-12 flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando fluxo…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Alertas críticos no topo (prioridade visual máxima) */}
      <FluxoCriticalAlerts alerts={criticalAlerts} onFocusNode={focusNodeById} />

      {/* Header: seletor de execução + status global */}
      <div className="nx-card p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className={cn(
              "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
              isRunning ? "bg-warning/15" : isLive ? "bg-primary/15" : "bg-elevated",
            )}>
              {isRunning ? <Zap className="h-4 w-4 text-warning animate-pulse" /> : isLive ? <Play className="h-4 w-4 text-primary" /> : <History className="h-4 w-4 text-muted-foreground" />}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                {isLive ? "Execução atual / mais recente" : "Replay de execução passada"}
              </p>
              <p className="text-sm font-bold text-foreground">
                {run ? (
                  <>
                    {run.genreName} ·{" "}
                    <span className={cn(
                      "uppercase text-[11px]",
                      run.status === "running" && "text-warning",
                      run.status === "success" && "text-success",
                      run.status === "error" && "text-destructive",
                    )}>{run.status}</span>{" "}
                    <span className="text-muted-foreground font-normal">· {timeAgo(run.startedAt)}</span>
                  </>
                ) : (
                  "Nenhuma execução encontrada"
                )}
              </p>
            </div>
          </div>

          <Select value={selectedRunId} onValueChange={setSelectedRunId}>
            <SelectTrigger className="w-full sm:w-[280px] h-9 text-xs">
              <SelectValue placeholder="Selecionar execução" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="live">⚡ Ao vivo (mais recente)</SelectItem>
              {runs.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.genreName} · {r.status} · {timeAgo(r.startedAt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isRunning && run && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1 tabular-nums">
              <span>Progresso geral</span>
              <span>{run.progressPct}%</span>
            </div>
            <Progress value={run.progressPct} className="h-1.5" />
          </div>
        )}
      </div>

      {/* Pipeline visual — palco premium */}
      <div className="nx-card fluxo-stage p-4 sm:p-8 overflow-x-auto nx-scroll">
        {/* Mobile: vertical | Desktop: horizontal */}
        <div className="flex flex-col lg:hidden gap-0 max-w-md mx-auto">
          {nodes.map((n, idx) => (
            <div key={n.id} className="animate-fade-in" style={{ animationDelay: `${idx * 60}ms` }}>
              <FluxoNode node={n} onClick={() => openDrawer(n)} selected={selectedNode?.id === n.id && drawerOpen} />
              {idx < nodes.length - 1 && (
                <FluxoConnector status={n.status} vertical />
              )}
            </div>
          ))}
        </div>

        <div className="hidden lg:flex items-stretch gap-0 min-w-[1280px] mx-auto">
          {nodes.map((n, idx) => (
            <div
              key={n.id}
              className="flex items-stretch flex-1 animate-fade-in"
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              <div className="flex-1 min-w-[150px]">
                <FluxoNode node={n} onClick={() => openDrawer(n)} selected={selectedNode?.id === n.id && drawerOpen} />
              </div>
              {idx < nodes.length - 1 && (
                <div className="flex items-center w-16 shrink-0 px-1.5">
                  <FluxoConnector status={n.status} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Legenda */}
      <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground px-1">
        <LegendDot color="bg-success" label="sucesso" />
        <LegendDot color="bg-warning animate-pulse" label="rodando" />
        <LegendDot color="bg-destructive" label="erro" />
        <LegendDot color="bg-muted-foreground/40" label="aguardando" />
        <span className="ml-auto hidden sm:inline">Clique em qualquer etapa para ver detalhes →</span>
      </div>

      <FluxoNodeDrawer node={selectedNode} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", color)} />
      <span className="uppercase tracking-wider">{label}</span>
    </span>
  );
}
