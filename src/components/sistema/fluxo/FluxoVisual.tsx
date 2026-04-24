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

    let logsQ = supabase.from("collection_logs").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(200);
    if (until) logsQ = logsQ.lte("created_at", until);
    if (fluxoRun) logsQ = logsQ.or(`genre_id.eq.${fluxoRun.genreId},genre_id.is.null`);

    let adjQ = supabase.from("playlist_adjustments").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(50);
    if (until) adjQ = adjQ.lte("created_at", until);

    const [logsRes, adjRes, flagsRes, termsRes] = await Promise.all([
      logsQ,
      adjQ,
      supabase.from("system_flags").select("apify_blocked, apify_blocked_reason").eq("singleton_key", "app").maybeSingle(),
      supabase.from("search_terms").select("id", { count: "exact", head: true }).eq(
        fluxoRun ? "genre_id" : "executado", fluxoRun ? fluxoRun.genreId : true,
      ),
    ]);

    // Stats de search_results para o gênero selecionado (ou geral)
    const baseQ = fluxoRun
      ? supabase.from("search_results").select("id, is_valid, spotify_playlist_id", { count: "exact" }).eq("genre_id", fluxoRun.genreId)
      : supabase.from("search_results").select("id, is_valid, spotify_playlist_id", { count: "exact" });
    const [allRes, validRes, invalidRes] = await Promise.all([
      baseQ,
      (fluxoRun
        ? supabase.from("search_results").select("id", { count: "exact", head: true }).eq("genre_id", fluxoRun.genreId).eq("is_valid", true)
        : supabase.from("search_results").select("id", { count: "exact", head: true }).eq("is_valid", true)),
      (fluxoRun
        ? supabase.from("search_results").select("id", { count: "exact", head: true }).eq("genre_id", fluxoRun.genreId).eq("is_valid", false)
        : supabase.from("search_results").select("id", { count: "exact", head: true }).eq("is_valid", false)),
    ]);

    // Playlists publicadas (templates com spotify_playlist_id)
    const pubRes = fluxoRun
      ? await supabase.from("playlist_templates").select("id", { count: "exact", head: true }).eq("genre_id", fluxoRun.genreId).not("spotify_playlist_id", "is", null)
      : await supabase.from("playlist_templates").select("id", { count: "exact", head: true }).not("spotify_playlist_id", "is", null);

    const built = buildFluxoNodes({
      run: fluxoRun,
      logs: logsRes.data ?? [],
      adjusts: adjRes.data ?? [],
      searchStats: {
        termsCount: termsRes.count ?? 0,
        rawPlaylists: allRes.count ?? 0,
        validPlaylists: validRes.count ?? 0,
        invalidPlaylists: invalidRes.count ?? 0,
        publishedPlaylists: pubRes.count ?? 0,
      },
      apifyBlocked: {
        blocked: flagsRes.data?.apify_blocked ?? false,
        reason: flagsRes.data?.apify_blocked_reason ?? undefined,
      },
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

  if (loading) {
    return (
      <div className="nx-card p-12 flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando fluxo…
      </div>
    );
  }

  return (
    <div className="space-y-4">
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

      {/* Pipeline visual */}
      <div className="nx-card p-3 sm:p-5 overflow-x-auto nx-scroll">
        {/* Mobile: vertical | Desktop: horizontal */}
        <div className="flex flex-col lg:hidden gap-0">
          {nodes.map((n, idx) => (
            <div key={n.id}>
              <FluxoNode node={n} onClick={() => openDrawer(n)} selected={selectedNode?.id === n.id && drawerOpen} />
              {idx < nodes.length - 1 && (
                <FluxoConnector status={n.status} vertical />
              )}
            </div>
          ))}
        </div>

        <div className="hidden lg:flex items-stretch gap-0 min-w-[1100px]">
          {nodes.map((n, idx) => (
            <div key={n.id} className="flex items-stretch flex-1">
              <div className="flex-1 min-w-[140px]">
                <FluxoNode node={n} onClick={() => openDrawer(n)} selected={selectedNode?.id === n.id && drawerOpen} />
              </div>
              {idx < nodes.length - 1 && (
                <div className="flex items-center w-12 shrink-0 px-1">
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
        <span className="ml-auto">Clique em qualquer etapa para ver detalhes →</span>
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
