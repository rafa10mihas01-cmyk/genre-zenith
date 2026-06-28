// FluxoVisual — orquestrador do pipeline atual do sistema.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, RefreshCw, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FluxoNode } from "./FluxoNode";
import { FluxoConnector } from "./FluxoConnector";
import { FluxoNodeDrawer } from "./FluxoNodeDrawer";
import { FluxoCriticalAlerts, extractCriticalAlerts } from "./FluxoCriticalAlerts";
import { buildFluxoNodes } from "./buildFluxo";
import type { FluxoNodeData } from "./types";

export function FluxoVisual({ compact = false }: { compact?: boolean }) {
  const [nodes, setNodes] = useState<FluxoNodeData[]>([]);
  const [selectedNode, setSelectedNode] = useState<FluxoNodeData | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const loadFluxo = async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: stats, error: statsErr } = await supabase.functions.invoke("get-sistema-stats", {
      body: { genre_id: null, run_id: null, since, until: null },
    });

    if (statsErr) {
      console.error("[FluxoVisual] get-sistema-stats falhou:", statsErr);
      setLoading(false);
      return;
    }

    const sr = stats?.searchStats ?? { total: 0, valid: 0, invalid: 0, avgFollowersValid: null };
    const todayISO = new Date();
    todayISO.setHours(0, 0, 0, 0);
    const dayAgoISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [catTotal, catActive, dealsActive, songsPending, jobsAgg] = await Promise.all([
      supabase.from("managed_playlists").select("id", { count: "exact", head: true }),
      supabase.from("managed_playlists").select("id", { count: "exact", head: true }).neq("playlist_type", "ARCHIVED"),
      supabase.from("curator_deals").select("id", { count: "exact", head: true }).is("closed_at", null),
      supabase.from("curator_deal_songs").select("id", { count: "exact", head: true }).is("ends_at", null),
      supabase.from("playlist_execution_jobs").select("status, completed_at, created_at").gte("created_at", dayAgoISO).limit(5000),
    ]);

    const jobsRows = (jobsAgg.data ?? []) as Array<{ status: string; completed_at: string | null }>;
    const execStat = {
      pending: jobsRows.filter((j) => j.status === "pending").length,
      claimed: jobsRows.filter((j) => j.status === "claimed").length,
      doneToday: jobsRows.filter((j) => j.status === "done" && j.completed_at && new Date(j.completed_at) >= todayISO).length,
      failed24h: jobsRows.filter((j) => j.status === "failed").length,
    };

    const built = buildFluxoNodes({
      run: null,
      logs: stats?.logs ?? [],
      searchStats: {
        termsCount: stats?.termsCount ?? 0,
        rawPlaylists: sr.total,
        validPlaylists: sr.valid,
        invalidPlaylists: sr.invalid,
        avgFollowersValid: sr.avgFollowersValid,
      },
      // Apify foi descontinuado — coleta agora é 100% via Spotify Web API.
      discoveryBlocked: { blocked: false },
      genreFilter: stats?.genreFilter ?? null,
      catalogStat: { total: catTotal.count ?? 0, active: catActive.count ?? 0 },
      dealStat: { activeDeals: dealsActive.count ?? 0, pendingSongs: songsPending.count ?? 0, dueToday: 0 },
      execStat,
    });

    setNodes(built);
    setLastUpdated(new Date().toISOString());
    setLoading(false);
  };

  useEffect(() => {
    loadFluxo();
    const ch = supabase
      .channel("fluxo-atual")
      .on("postgres_changes", { event: "*", schema: "public", table: "collection_logs" }, () => loadFluxo())
      .on("postgres_changes", { event: "*", schema: "public", table: "search_results" }, () => loadFluxo())
      .on("postgres_changes", { event: "*", schema: "public", table: "playlist_execution_jobs" }, () => loadFluxo())
      .on("postgres_changes", { event: "*", schema: "public", table: "managed_playlists" }, () => loadFluxo())
      .on("postgres_changes", { event: "*", schema: "public", table: "curator_deals" }, () => loadFluxo())
      .subscribe();
    const t = setInterval(loadFluxo, 15_000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
     
  }, []);

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
      <FluxoCriticalAlerts alerts={criticalAlerts} onFocusNode={focusNodeById} />

      <div className="nx-card p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-primary/15">
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Fluxo atual do sistema</p>
              <p className="text-sm font-bold text-foreground">
                Spotify → Filtro → Catálogo → Deal → Execução
                {lastUpdated && <span className="text-muted-foreground font-normal"> · atualizado agora</span>}
              </p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={loadFluxo} className="h-8 gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar
          </Button>
        </div>
      </div>

      <div className={cn("nx-card fluxo-stage overflow-x-auto nx-scroll", compact ? "p-4" : "p-4 sm:p-8")}>
        <div className="flex flex-col lg:hidden gap-0 max-w-md mx-auto">
          {nodes.map((n, idx) => (
            <div key={n.id} className="animate-fade-in" style={{ animationDelay: `${idx * 60}ms` }}>
              <FluxoNode node={n} onClick={() => openDrawer(n)} selected={selectedNode?.id === n.id && drawerOpen} />
              {idx < nodes.length - 1 && <FluxoConnector status={n.status} vertical />}
            </div>
          ))}
        </div>

        <div className="hidden lg:flex items-stretch gap-0 min-w-[1280px] mx-auto">
          {nodes.map((n, idx) => (
            <div key={n.id} className="flex items-stretch flex-1 animate-fade-in" style={{ animationDelay: `${idx * 60}ms` }}>
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
