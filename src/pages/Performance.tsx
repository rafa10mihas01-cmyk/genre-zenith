import { useEffect, useMemo, useState } from "react";
import { BarChart3, RefreshCw, Brain, Activity } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";
import { PageContainer } from "@/components/PageContainer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useScreenField } from "@/lib/screen-state";
import { useSetSidebarKpis } from "@/contexts/SidebarContext";

import { PerformanceKpis } from "@/components/performance/PerformanceKpis";
import { PriorityActionsCard } from "@/components/performance/PriorityActionsCard";
import { GenreRanking } from "@/components/performance/GenreRanking";
import { PlaylistsTable } from "@/components/performance/PlaylistsTable";
import { InsightsPanel } from "@/components/performance/InsightsPanel";
import { TopMovers } from "@/components/performance/TopMovers";
import { FollowersTimeline } from "@/components/performance/FollowersTimeline";
import { SeoScorePanel } from "@/components/performance/SeoScorePanel";
import { BeforeAfterTimeline } from "@/components/performance/BeforeAfterTimeline";
import MatrizPlaylists from "@/pages/MatrizPlaylists";
import type { DatasetRow, Insight, GenreRow } from "@/components/performance/types";

export default function Performance() {
  const [dataset, setDataset] = useState<DatasetRow[]>([]);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [genres, setGenres] = useState<GenreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useScreenField<string>("/performance", "tab", "visao");

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

  // Hero status: estado do sistema de performance
  const heroStatus = useMemo(() => {
    if (loading && totalPubs === 0) {
      return { label: "Carregando dados", tone: "info" as const, pulse: true };
    }
    if (tracking) {
      return { label: "Coletando dados…", tone: "info" as const, pulse: true };
    }
    if (analyzing) {
      return { label: "Analisando com Claude…", tone: "primary" as const, pulse: true };
    }
    if (totalPubs === 0) {
      return { label: "Sem dados", tone: "muted" as const, pulse: false };
    }
    const withData = dataset.filter((d) => (d.followers_now ?? 0) > 0).length;
    if (withData === 0) {
      return { label: "Aguardando histórico", tone: "warning" as const, pulse: true };
    }
    return { label: "Sistema ativo", tone: "success" as const, pulse: false };
  }, [loading, tracking, analyzing, totalPubs, dataset]);

  return (
    <PageContainer>
      <PageHeader
        domain="system"
        title="Performance"
        subtitle="Crescimento e resultados"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={runTrack} disabled={tracking}>
              <RefreshCw className={`h-4 w-4 xl:mr-2 ${tracking ? "animate-spin" : ""}`} />
              <span className="hidden xl:inline">Coletar dados</span>
            </Button>
            <Button size="sm" onClick={runAnalyze} disabled={analyzing || totalPubs === 0}>
              <Brain className={`h-4 w-4 xl:mr-2 ${analyzing ? "animate-pulse" : ""}`} />
              <span className="truncate">Analisar agora</span>
            </Button>
          </>
        }
      />
      <AnalyticsTabs />

      {/* Hero status — estado do sistema (mobile-first) */}
      <HeroStatus status={heroStatus} totalPubs={totalPubs} />

      {totalPubs === 0 && !loading ? (
        <Card className="p-6 md:p-8 text-center">
          <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-bold text-base md:text-lg">Sem playlists publicadas</h3>
          <p className="text-xs md:text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
            Quando o módulo Operação publicar playlists no Spotify, elas aparecerão aqui com métricas e análise do Claude.
          </p>
        </Card>
      ) : (
        <>
          {/* KPIs sempre visíveis no topo */}
          <PerformanceKpis dataset={dataset} loading={loading && totalPubs === 0} />

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3 md:space-y-4">
            <TabsList>
              <TabsTrigger value="visao">Visão geral</TabsTrigger>
              <TabsTrigger value="acoes" className="gap-1.5">
                Ações
                {insight && Array.isArray(insight.acoes_sugeridas) && insight.acoes_sugeridas.length > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary/15 text-primary text-[10px] font-bold tabular-nums">
                    {insight.acoes_sugeridas.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="detalhe">Detalhe ({totalPubs})</TabsTrigger>
              <TabsTrigger value="matriz">Matriz</TabsTrigger>
            </TabsList>

            {/* Visão geral — o que aconteceu */}
            <TabsContent value="visao" className="space-y-3 md:space-y-4 animate-tab-in mt-0">
              <FollowersTimeline />
              <TopMovers dataset={dataset} />
              <GenreRanking dataset={dataset} genres={genres} />
            </TabsContent>

            {/* Ações — o que fazer */}
            <TabsContent value="acoes" className="space-y-3 md:space-y-4 animate-tab-in mt-0">
              <PriorityActionsCard insight={insight} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
                <SeoScorePanel />
                <BeforeAfterTimeline />
              </div>
              <InsightsPanel insight={insight} />
              {insight && (
                <p className="text-[10px] text-muted-foreground text-right">
                  Última análise: {new Date(insight.created_at).toLocaleString("pt-BR")}
                  {insight.generated_by_model ? ` • ${insight.generated_by_model}` : ""}
                </p>
              )}
            </TabsContent>

            {/* Detalhe — tabela de playlists */}
            <TabsContent value="detalhe" className="min-h-[480px] animate-tab-in mt-0">
              <PlaylistsTable dataset={dataset} genres={genres} altaIds={altaIds} baixaIds={baixaIds} />
            </TabsContent>

            {/* Matriz — capacidade × confiança (era aba top-level, virou sub-aba aqui) */}
            <TabsContent value="matriz" className="min-h-[480px] animate-tab-in mt-0">
              <MatrizPlaylists embedded />
            </TabsContent>
          </Tabs>
        </>
      )}
    </PageContainer>
  );
}

/* ----------------------------------------------------------- */
/* HeroStatus — bloco compacto que comunica o estado do sistema */
/* ----------------------------------------------------------- */
type HeroTone = "info" | "primary" | "success" | "warning" | "muted";

const TONE_DOT: Record<HeroTone, string> = {
  info:    "bg-info",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  muted:   "bg-muted-foreground",
};

const TONE_TEXT: Record<HeroTone, string> = {
  info:    "text-info",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  muted:   "text-muted-foreground",
};

function HeroStatus({
  status,
  totalPubs,
}: {
  status: { label: string; tone: HeroTone; pulse: boolean };
  totalPubs: number;
}) {
  return (
    <Card className="p-3 md:p-4 flex items-center gap-3 md:gap-4">
      <div className="relative shrink-0">
        <span
          className={`block h-2.5 w-2.5 rounded-full ${TONE_DOT[status.tone]}`}
          aria-hidden
        />
        {status.pulse && (
          <span
            className={`absolute inset-0 rounded-full ${TONE_DOT[status.tone]} opacity-60 animate-ping`}
            aria-hidden
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
            Estado do sistema
          </span>
        </div>
        <div className={`text-sm md:text-base font-semibold leading-tight mt-0.5 ${TONE_TEXT[status.tone]}`}>
          {status.label}
        </div>
      </div>
      <div className="hidden sm:flex flex-col items-end shrink-0">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          Publicadas
        </span>
        <span className="text-base md:text-lg font-bold tabular-nums leading-tight">
          {totalPubs}
        </span>
      </div>
    </Card>
  );
}
