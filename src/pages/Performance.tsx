import { useEffect, useState } from "react";
import { BarChart3, RefreshCw, Sparkles, TrendingUp, TrendingDown, Activity, ExternalLink, Brain } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { KpiBig } from "@/components/KpiBig";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LoadMore, usePagination } from "@/components/LoadMore";

type DatasetRow = {
  template_id: string;
  genre_id: string | null;
  nome: string;
  spotify_playlist_id: string;
  spotify_url: string | null;
  followers_start: number;
  followers_now: number;
  crescimento_absoluto: number;
  crescimento_percentual: number | null;
  tempo_horas: number | null;
  total_tracks: number | null;
  created_on_spotify_at: string;
  last_snapshot_at: string | null;
};

type Insight = {
  id: string;
  scope: string;
  total_playlists_analisadas: number;
  insights: { padroes_vencedores?: string[]; padroes_fracos?: string[] };
  recomendacoes: string[];
  acoes_sugeridas: Array<{ tipo: string; playlist?: string; motivo: string; acao?: string; prioridade: string }>;
  classificacao: { alta?: string[]; media?: string[]; baixa?: string[] };
  generated_by_model: string | null;
  created_at: string;
};

export default function Performance() {
  const [dataset, setDataset] = useState<DatasetRow[]>([]);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: ds }, { data: ins }] = await Promise.all([
      supabase.rpc("get_performance_dataset", { p_min_age_hours: 0 }),
      supabase.from("performance_insights").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setDataset((ds as unknown as DatasetRow[]) ?? []);
    setInsight((ins as unknown as Insight) ?? null);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

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
      if (data?.empty) { toast.warning(data.message); }
      else { toast.success(`Claude analisou ${data?.analisadas ?? 0} playlists`); }
      await load();
    } catch (e: any) {
      toast.error(`Falha ao analisar: ${e.message}`);
    } finally { setAnalyzing(false); }
  }

  // KPIs
  const totalPubs = dataset.length;
  const totalGrowth = dataset.reduce((s, r) => s + (r.crescimento_absoluto || 0), 0);
  const avgPct = dataset.filter(r => r.crescimento_percentual != null).length
    ? (dataset.reduce((s, r) => s + (r.crescimento_percentual || 0), 0) / dataset.filter(r => r.crescimento_percentual != null).length)
    : 0;
  const altaIds = new Set(insight?.classificacao?.alta ?? []);
  const baixaIds = new Set(insight?.classificacao?.baixa ?? []);

  return (
    <PageContainer>
      <PageHeader
        kicker="Módulo"
        icon={BarChart3}
        title="Performance"
        subtitle="Monitorar crescimento das playlists publicadas e aprender com os padrões vencedores."
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

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBig label="Playlists publicadas"       value={totalPubs} icon={Activity} />
        <KpiBig label="Seguidores ganhos (total)"  value={totalGrowth.toLocaleString("pt-BR")} icon={TrendingUp} tone="success" />
        <KpiBig label="Crescimento médio (%)"      value={`${avgPct.toFixed(1)}%`} icon={Sparkles} tone="primary" />
        <KpiBig label="Última análise"
          value={insight ? new Date(insight.created_at).toLocaleDateString("pt-BR") : "—"}
          icon={Brain} />
      </div>

      {totalPubs === 0 ? (
        <Card className="p-12 text-center">
          <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-bold text-lg">Nenhuma playlist publicada ainda</h3>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
            Quando o módulo Operação publicar playlists no Spotify, elas aparecerão aqui com métricas e análise do Claude.
          </p>
        </Card>
      ) : (
        <Tabs defaultValue="insights" className="space-y-4">
          <TabsList>
            <TabsTrigger value="insights">Insights do Claude</TabsTrigger>
            <TabsTrigger value="playlists">Playlists ({totalPubs})</TabsTrigger>
            <TabsTrigger value="acoes">Ações sugeridas</TabsTrigger>
          </TabsList>

          {/* INSIGHTS */}
          <TabsContent value="insights" className="space-y-4">
            {!insight ? (
              <Card className="p-8 text-center">
                <Brain className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  Ainda não há análise. Clique em <strong className="text-foreground">Analisar com Claude</strong> para gerar a primeira interpretação.
                </p>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                <Card className="p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-success" />
                    <h3 className="font-bold">Padrões vencedores</h3>
                  </div>
                  <ul className="space-y-2">
                    {(insight.insights.padroes_vencedores ?? []).map((p, i) => (
                      <li key={i} className="text-sm flex gap-2">
                        <span className="text-success mt-1">▸</span>
                        <span>{p}</span>
                      </li>
                    ))}
                    {!insight.insights.padroes_vencedores?.length && (
                      <li className="text-xs text-muted-foreground">Sem padrões identificados.</li>
                    )}
                  </ul>
                </Card>
                <Card className="p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-destructive" />
                    <h3 className="font-bold">Padrões fracos</h3>
                  </div>
                  <ul className="space-y-2">
                    {(insight.insights.padroes_fracos ?? []).map((p, i) => (
                      <li key={i} className="text-sm flex gap-2">
                        <span className="text-destructive mt-1">▸</span>
                        <span>{p}</span>
                      </li>
                    ))}
                    {!insight.insights.padroes_fracos?.length && (
                      <li className="text-xs text-muted-foreground">Nenhum padrão fraco detectado.</li>
                    )}
                  </ul>
                </Card>
                <Card className="p-5 space-y-3 md:col-span-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h3 className="font-bold">Recomendações para replicação</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(insight.recomendacoes ?? []).map((r, i) => (
                      <Badge key={i} variant="outline" className="text-xs py-1.5 px-3">
                        {r}
                      </Badge>
                    ))}
                    {!insight.recomendacoes?.length && (
                      <span className="text-xs text-muted-foreground">Sem recomendações.</span>
                    )}
                  </div>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* PLAYLISTS */}
          <TabsContent value="playlists">
            <PlaylistsTable dataset={dataset} altaIds={altaIds} baixaIds={baixaIds} />
          </TabsContent>

          {/* AÇÕES */}
          <TabsContent value="acoes">
            {!insight?.acoes_sugeridas?.length ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                Nenhuma ação sugerida ainda. Rode uma análise.
              </Card>
            ) : (
              <div className="space-y-2">
                {insight.acoes_sugeridas.map((a, i) => (
                  <Card key={i} className="p-4 flex items-start gap-3">
                    <Badge
                      variant={a.prioridade === "alta" ? "default" : a.prioridade === "baixa" ? "outline" : "secondary"}
                      className="uppercase text-[10px]"
                    >
                      {a.prioridade}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm uppercase tracking-wide">{a.tipo}</span>
                        {a.playlist && <span className="text-xs text-muted-foreground truncate">{a.playlist}</span>}
                      </div>
                      <p className="text-sm mt-1">{a.acao ?? a.motivo}</p>
                      {a.acao && <p className="text-xs text-muted-foreground mt-0.5">{a.motivo}</p>}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      {loading && <p className="text-xs text-muted-foreground text-center">Carregando…</p>}
    </PageContainer>
  );
}

function PlaylistsTable({
  dataset, altaIds, baixaIds,
}: {
  dataset: DatasetRow[];
  altaIds: Set<string>;
  baixaIds: Set<string>;
}) {
  const sorted = dataset
    .slice()
    .sort((a, b) => (b.crescimento_percentual ?? -1) - (a.crescimento_percentual ?? -1));
  const { visibleItems, hasMore, loadMore, total, visible } = usePagination(sorted, 20);

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-elevated text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3">Playlist</th>
                <th className="text-right p-3">Seguidores</th>
                <th className="text-right p-3">Crescimento</th>
                <th className="text-right p-3">%</th>
                <th className="text-right p-3">Idade</th>
                <th className="text-center p-3">Classe</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((r) => {
                const cls = altaIds.has(r.template_id) ? "alta"
                  : baixaIds.has(r.template_id) ? "baixa" : "media";
                return (
                  <tr key={r.template_id} className="border-t border-border hover:bg-elevated/40">
                    <td className="p-3 font-medium truncate max-w-[280px]">{r.nome}</td>
                    <td className="p-3 text-right tabular-nums">{r.followers_now.toLocaleString("pt-BR")}</td>
                    <td className={`p-3 text-right tabular-nums font-bold ${r.crescimento_absoluto > 0 ? "text-success" : r.crescimento_absoluto < 0 ? "text-destructive" : ""}`}>
                      {r.crescimento_absoluto > 0 ? "+" : ""}{r.crescimento_absoluto.toLocaleString("pt-BR")}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {r.crescimento_percentual != null ? `${r.crescimento_percentual}%` : "—"}
                    </td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground">
                      {r.tempo_horas != null ? `${r.tempo_horas}h` : "—"}
                    </td>
                    <td className="p-3 text-center">
                      <Badge variant={cls === "alta" ? "default" : cls === "baixa" ? "destructive" : "secondary"} className="text-[10px]">
                        {cls.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      {r.spotify_url && (
                        <a href={r.spotify_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary inline-flex">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <LoadMore visible={visible} total={total} hasMore={hasMore} onLoadMore={loadMore} itemLabel="playlists" />
    </div>
  );
}


