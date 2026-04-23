import { useEffect, useState } from "react";
import { BarChart3, RefreshCw, Brain } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useSetSidebarKpis } from "@/contexts/SidebarContext";

import { PerformanceKpis } from "@/components/performance/PerformanceKpis";
import { PriorityActionsCard } from "@/components/performance/PriorityActionsCard";
import { GenreRanking } from "@/components/performance/GenreRanking";
import { PlaylistsTable } from "@/components/performance/PlaylistsTable";
import { InsightsPanel } from "@/components/performance/InsightsPanel";
import type { DatasetRow, Insight, GenreRow } from "@/components/performance/types";

export default function Performance() {
  const [dataset, setDataset] = useState<DatasetRow[]>([]);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [genres, setGenres] = useState<GenreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = usePersistedState<string>("performance:tab", "playlists");

  async function load() {
    setLoading(true);
    const [{ data: ds }, { data: ins }, { data: gs }] = await Promise.all([
      supabase.rpc("get_performance_dataset", { p_min_age_hours: 0 }),
      supabase.from("performance_insights").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("genres").select("id, nome").order("nome"),
    ]);
    setDataset((ds as unknown as DatasetRow[]) ?? []);
    setInsight((ins as unknown as Insight) ?? null);
    setGenres((gs as GenreRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Sidebar KPIs: com dados / aguardando
  useSetSidebarKpis([
    {
      label: "Com dados",
      value: dataset.filter((d) => (d.followers_now ?? 0) > 0).length,
      intent: "primary",
    },
    {
      label: "Aguardando",
      value: dataset.filter((d) => !d.followers_now || d.followers_now === 0).length,
      intent: "warning",
    },
    { label: "Total", value: dataset.length, intent: "default" },
  ]);

  async function runTrack() {
    setTracking(true);
    try {
      const { data, error } = await supabase.functions.invoke("track-playlist-metrics", { body: {} });
      if (error) throw error;
      toast.success(`Snapshots ok: ${data?.snapshots_ok ?? 0} (falharam: ${data?.failed ?? 0})`);
      await load();
    } catch (e: any) {
      toast.error(`Falha ao coletar: ${e.message}`);
    } finally { setTracking(false); }
  }

  async function runAnalyze() {
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-performance", { body: { min_age_hours: 0 } });
      if (error) throw error;
      if (data?.empty) toast.warning(data.message);
      else toast.success(`Claude analisou ${data?.analisadas ?? 0} playlists`);
      await load();
    } catch (e: any) {
      toast.error(`Falha ao analisar: ${e.message}`);
    } finally { setAnalyzing(false); }
  }

  const totalPubs = dataset.length;
  const altaIds = new Set(insight?.classificacao?.alta ?? []);
  const baixaIds = new Set(insight?.classificacao?.baixa ?? []);

  return (
    <PageContainer>
      <PageHeader
        kicker="Módulo"
        icon={BarChart3}
        title="Performance"
        subtitle="Acompanhar saúde, ranking de gêneros e ações prioritárias para crescer mais rápido."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={runTrack} disabled={tracking}>
              <RefreshCw className={`h-4 w-4 mr-2 ${tracking ? "animate-spin" : ""}`} />
              Coletar agora
            </Button>
            <Button size="sm" onClick={runAnalyze} disabled={analyzing || totalPubs === 0}>
              <Brain className={`h-4 w-4 mr-2 ${analyzing ? "animate-pulse" : ""}`} />
              Analisar com Claude
            </Button>
          </>
        }
      />

      {totalPubs === 0 && !loading ? (
        <Card className="p-8 text-center">
          <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-bold text-lg">Nenhuma playlist publicada ainda</h3>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
            Quando o módulo Operação publicar playlists no Spotify, elas aparecerão aqui com métricas e análise do Claude.
          </p>
        </Card>
      ) : (
        <>
          {/* 1. KPIs principais — o que está acontecendo (com skeletons enquanto carrega) */}
          <PerformanceKpis dataset={dataset} loading={loading && totalPubs === 0} />

          {/* 2. Próximas ações + última análise — o que fazer agora */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PriorityActionsCard insight={insight} />
            <Card className="p-5 flex items-center gap-4 min-h-[96px]">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Brain className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-sm">Última análise</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {insight
                    ? `${new Date(insight.created_at).toLocaleString("pt-BR")} — ${insight.total_playlists_analisadas} playlists`
                    : "Nenhuma análise gerada ainda."}
                </p>
                {insight?.generated_by_model && (
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">
                    {insight.generated_by_model}
                  </p>
                )}
              </div>
            </Card>
          </div>

          {/* 3. Ranking por gênero — onde investir */}
          <GenreRanking dataset={dataset} genres={genres} />

          {/* 4. Detalhe — playlists com filtros e padrões aprendidos */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList>
              <TabsTrigger value="playlists">Playlists ({totalPubs})</TabsTrigger>
              <TabsTrigger value="insights">Padrões aprendidos</TabsTrigger>
            </TabsList>
            {/* min-h estável para evitar layout shift na troca de aba */}
            <TabsContent value="playlists" className="min-h-[480px] animate-tab-in mt-0">
              <PlaylistsTable dataset={dataset} genres={genres} altaIds={altaIds} baixaIds={baixaIds} />
            </TabsContent>
            <TabsContent value="insights" className="min-h-[480px] animate-tab-in mt-0">
              <InsightsPanel insight={insight} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </PageContainer>
  );
}
