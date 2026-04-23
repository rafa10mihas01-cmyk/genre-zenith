import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Brain, Sparkles, Loader2, RefreshCw, ListMusic, Music2, TrendingUp, Hash,
  ExternalLink, Image as ImageIcon, Palette, Wand2, FileText, Activity, Layers,
  ArrowRight, Search, Lightbulb, Wrench, Radio, BarChart3, Rocket,
} from "lucide-react";
import { useBrainModel } from "@/hooks/useBrainModel";
import { useBriefings } from "@/hooks/useBriefings";
import { formatNumber, timeAgo, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { genreStyleVars } from "@/lib/genreColors";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Replicacao } from "@/components/brain/Replicacao";
import { ReplicacaoAuto } from "@/components/brain/ReplicacaoAuto";
import { KpiBig } from "@/components/KpiBig";

/**
 * CÉREBRO — módulo único com 6 abas internas.
 * - /cerebro              → primeiro gênero analisado (default)
 * - /cerebro/:slug        → gênero específico
 *
 * Substitui as páginas antigas: BrainDetail, ModelDetail, Collect, Logs, Genres, Models.
 * Todo o conteúdo está migrado em abas. Sem duplicar arquivo, sem rotas extras.
 */

type GenreOpt = { id: string; slug: string; nome: string };

export default function Cerebro() {
  const { slug: paramSlug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const [genres, setGenres] = useState<GenreOpt[]>([]);
  const [activeSlug, setActiveSlug] = useState<string>(paramSlug ?? "");
  const [tab, setTab] = useState("visao");
  const [running, setRunning] = useState(false);

  // Carrega lista de gêneros (para o dropdown) e seleciona default
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("genres")
        .select("id,slug,nome,total_playlists")
        .order("total_playlists", { ascending: false, nullsFirst: false });
      const list = (data ?? []) as (GenreOpt & { total_playlists: number | null })[];
      setGenres(list);
      // Se a URL não tem slug, vai pra primeiro gênero com dados
      if (!paramSlug && list.length > 0) {
        const first = list.find(g => (g.total_playlists ?? 0) > 0) ?? list[0];
        setActiveSlug(first.slug);
        navigate(`/cerebro/${first.slug}`, { replace: true });
      } else if (paramSlug) {
        setActiveSlug(paramSlug);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramSlug]);

  const { loading: loadingModel, genre, model, reload: reloadModel } = useBrainModel(activeSlug);
  const { loading: loadingBriefing, briefing, generating, regenerate, analyzeVisualDna, analyzingDna } =
    useBriefings(genre?.id);

  const handleChangeGenre = (s: string) => {
    setActiveSlug(s);
    navigate(`/cerebro/${s}`);
  };

  const runBrain = async () => {
    if (!activeSlug || running) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("brain-run", {
        body: { slug: activeSlug, intensity: "normal", max_playlists: 50 },
      });
      if (error) throw error;
      toast.success("Análise iniciada", { description: "Acompanhe pela aba Decisões em alguns minutos." });
    } catch (e: any) {
      toast.error("Erro ao iniciar", { description: e?.message });
    } finally {
      setRunning(false);
    }
  };

  if (genres.length === 0) {
    return (
      <div className="nx-card p-12 text-center">
        <Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">Carregando gêneros…</p>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        kicker="Módulo de Inteligência"
        icon={Brain}
        title="Cérebro"
        subtitle="Analisar um gênero a fundo: coletar playlists, gerar modelo, briefing criativo e DNA visual."
        actions={
          <Button onClick={runBrain} disabled={running} className="nx-pill">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Atualizar inteligência
          </Button>
        }
      />

      {/* FAIXA DE GÊNEROS — chips coloridos com scroll horizontal */}
      <GenreStrip genres={genres} activeSlug={activeSlug} onPick={handleChangeGenre} />

      {/* HERO do gênero ativo — cor própria + KPIs grandes */}
      <GenreHero genre={genre} model={model} />

      {/* AÇÕES RÁPIDAS — atalhos contextuais do gênero */}
      <QuickActions slug={activeSlug} />

      {/* MINI-PIPELINE — estado do gênero atual */}
      <GenrePipeline genre={genre} model={model} />


      {/* TABS — 6 áreas internas */}
      <Tabs value={tab} onValueChange={setTab} className="space-y-5">
        <TabsList className="bg-transparent p-0 h-auto gap-6 border-b border-border rounded-none w-full justify-start">
          {[
            { v: "visao", label: "Visão Geral" },
            { v: "decisoes", label: "Decisões" },
            { v: "coleta", label: "Coleta" },
            { v: "base", label: "Base" },
            { v: "insights", label: "Insights" },
            { v: "visual", label: "Visual" },
            { v: "replicacao", label: "Replicação" },
          ].map(t => (
            <TabsTrigger
              key={t.v}
              value={t.v}
              className="bg-transparent rounded-none px-0 pb-3 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent border-b-2 border-transparent data-[state=active]:border-primary transition-colors"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="visao" className="mt-0">
          <VisaoGeral model={model} loading={loadingModel} genre={genre} />
        </TabsContent>
        <TabsContent value="decisoes" className="mt-0">
          <Decisoes
            briefing={briefing}
            loading={loadingBriefing}
            onRegenerate={async () => { try { await regenerate(); toast.success("Briefing regenerado"); } catch (e: any) { toast.error(e?.message); } }}
            onAnalyzeDna={async () => { try { await analyzeVisualDna(); toast.success("DNA visual atualizado"); } catch (e: any) { toast.error(e?.message); } }}
            generating={generating}
            analyzingDna={analyzingDna}
          />
        </TabsContent>
        <TabsContent value="coleta" className="mt-0">
          <Coleta genreId={genre?.id} />
        </TabsContent>
        <TabsContent value="base" className="mt-0">
          <Base model={model} loading={loadingModel} />
        </TabsContent>
        <TabsContent value="insights" className="mt-0">
          <Insights model={model} loading={loadingModel} onReload={reloadModel} />
        </TabsContent>
        <TabsContent value="visual" className="mt-0">
          <Visual briefing={briefing} loading={loadingBriefing} onAnalyze={analyzeVisualDna} analyzing={analyzingDna} />
        </TabsContent>
        <TabsContent value="replicacao" className="mt-0 space-y-8">
          <ReplicacaoAuto genreId={genre?.id} />
          <div className="border-t border-border pt-8">
            <Replicacao genreId={genre?.id} />
          </div>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function Stat({ label, value, valueRaw }: { label: string; value?: string; valueRaw?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</span>
      <span className="text-sm font-bold text-foreground tabular-nums">{valueRaw ?? value ?? "—"}</span>
    </div>
  );
}

/* ===================== ABAS ===================== */

function VisaoGeral({ model, loading, genre }: any) {
  if (loading) return <SkeletonGrid />;
  if (!model) return <Empty msg="Sem modelo gerado ainda. Clique em Atualizar inteligência." />;

  const insights = model.insights ?? {};
  const playlistsTop = (model.playlists_dominantes ?? []).slice(0, 5);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <KpiBig icon={ListMusic} label="Playlists analisadas" value={formatNumber(insights.total_playlists_analisadas)} />
      <KpiBig icon={Music2} label="Tracks únicas" value={formatNumber(insights.diversidade_tracks)} />
      <KpiBig icon={TrendingUp} label="Média de seguidores" value={formatNumber(insights.media_seguidores)} />

      <div className="nx-card p-5 lg:col-span-2">
        <h3 className="font-bold mb-3">Top playlists</h3>
        {playlistsTop.length === 0 ? <Empty msg="Sem playlists ranqueadas." />
          : (
            <div className="space-y-2">
              {playlistsTop.map((p: any, i: number) => (
                <a key={p.url + i} href={p.url} target="_blank" rel="noreferrer"
                   className="flex items-center gap-3 p-2 rounded-lg hover:bg-elevated transition-colors group">
                  <span className="text-sm font-bold text-muted-foreground w-6 tabular-nums">{i + 1}</span>
                  {p.imagem ? (
                    <img src={p.imagem} alt="" className="h-12 w-12 rounded object-cover shrink-0" loading="lazy" />
                  ) : (
                    <div className="h-12 w-12 rounded bg-elevated shrink-0 flex items-center justify-center"><Music2 className="h-4 w-4 text-muted-foreground" /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.nome}</div>
                    <div className="text-xs text-muted-foreground">{formatNumber(p.seguidores)} seguidores · {p.total_musicas ?? "—"} faixas</div>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                </a>
              ))}
            </div>
          )}
      </div>

      <div className="nx-card p-5">
        <h3 className="font-bold mb-3">Resumo do modelo</h3>
        <div className="text-sm text-muted-foreground leading-relaxed space-y-2">
          <p>
            Modelo gerado <span className="text-foreground font-medium">{timeAgo(model.ultima_analise)}</span>.
          </p>
          <p>
            <span className="text-foreground font-medium">{(model.palavras_chave ?? []).length}</span> palavras-chave,{" "}
            <span className="text-foreground font-medium">{(model.padroes_nome ?? []).length}</span> padrões de nome,{" "}
            <span className="text-foreground font-medium">{(model.musicas_recorrentes ?? []).length}</span> faixas recorrentes.
          </p>
        </div>
      </div>
    </div>
  );
}

function Decisoes({ briefing, loading, onRegenerate, onAnalyzeDna, generating, analyzingDna }: any) {
  if (loading) return <SkeletonGrid />;
  const items = briefing?.briefings ?? [];
  const hasBriefing = items.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-bold">Briefings de playlist</h3>
          <p className="text-xs text-muted-foreground">
            {hasBriefing ? `v${briefing.version} • ${items.length} formatos identificados` : "Nenhum briefing gerado."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onAnalyzeDna} disabled={analyzingDna || !hasBriefing}>
            {analyzingDna ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
            DNA visual
          </Button>
          <Button size="sm" onClick={onRegenerate} disabled={generating}>
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {hasBriefing ? "Regenerar" : "Gerar briefing"}
          </Button>
        </div>
      </div>

      {!hasBriefing ? <Empty msg="Sem briefings ainda." />
        : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {items.map((b: any, i: number) => (
              <div key={i} className="nx-card p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono text-muted-foreground">#{i + 1}</span>
                    <h4 className="font-bold text-sm truncate">{b.nome}</h4>
                  </div>
                  <span className={cn(
                    "text-[10px] uppercase font-bold px-2 py-0.5 rounded-full",
                    b.confidence === "alta" ? "bg-primary/15 text-primary"
                    : b.confidence === "media" ? "bg-warning/15 text-warning"
                    : "bg-muted text-muted-foreground",
                  )}>{b.confidence}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Formato: <span className="text-foreground font-medium">{b.formato}</span> • Força: <span className="text-foreground font-medium">{b.forca_nome}%</span>
                </div>
                {b.keywords_utilizadas?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {b.keywords_utilizadas.slice(0, 5).map((k: any) => (
                      <span key={k.value} className="text-[10px] px-1.5 py-0.5 rounded bg-elevated border border-border">{k.value}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

function Coleta({ genreId }: { genreId?: string }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [pending, setPending] = useState<number>(0);
  const [enriching, setEnriching] = useState(false);

  const load = async () => {
    let q = supabase.from("collection_logs").select("*").order("created_at", { ascending: false }).limit(40);
    if (genreId) q = q.eq("genre_id", genreId);
    const { data: l } = await q;
    setLogs(l ?? []);
    if (genreId) {
      const { count } = await supabase
        .from("search_results").select("*", { count: "exact", head: true })
        .eq("genre_id", genreId).is("seguidores", null).not("spotify_url", "is", null);
      setPending(count ?? 0);
    }
  };
  useEffect(() => { if (genreId) load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [genreId]);

  const runEnrich = async () => {
    if (!genreId) return;
    setEnriching(true);
    try {
      const { data, error } = await supabase.functions.invoke("enrich-playlists", {
        body: { genre_id: genreId, limit: 50, fetch_tracks: true },
      });
      if (error) throw error;
      toast.success(`${data?.enriched ?? 0} playlists enriquecidas`);
      load();
    } catch (e: any) { toast.error(e?.message); }
    setEnriching(false);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiBig icon={Activity} label="Logs (últimas 40)" value={String(logs.length)} />
        <KpiBig icon={Music2} label="Aguardando enrich" value={String(pending)} />
        <div className="nx-card p-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Ações</div>
            <div className="text-sm font-medium">Enriquecer playlists</div>
          </div>
          <Button size="sm" onClick={runEnrich} disabled={enriching || !genreId || pending === 0}>
            {enriching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Rodar
          </Button>
        </div>
      </div>

      <div className="nx-card divide-y divide-border max-h-[60vh] overflow-y-auto nx-scroll">
        {logs.length === 0 ? <Empty msg="Sem logs." />
          : logs.map(l => (
            <div key={l.id} className="px-4 py-2.5 flex items-start gap-3 text-xs">
              <span className={cn(
                "h-2 w-2 mt-1.5 rounded-full shrink-0",
                l.status === "sucesso" ? "bg-primary" : l.status === "erro" ? "bg-destructive" : "bg-warning",
              )} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="font-mono text-foreground">{l.acao}</span>
                  <span>·</span>
                  <span>{formatDate(l.created_at)}</span>
                  {l.duracao_ms != null && <><span>·</span><span className="font-mono">{l.duracao_ms}ms</span></>}
                </div>
                <p className="text-foreground/80 mt-0.5 break-words">{l.mensagem ?? "—"}</p>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

function Base({ model, loading }: any) {
  if (loading) return <SkeletonGrid />;
  if (!model) return <Empty msg="Sem dados de base." />;
  const playlists = model.playlists_dominantes ?? [];
  const tracks = model.musicas_recorrentes ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="nx-card p-5">
        <h3 className="font-bold mb-3">Playlists dominantes ({playlists.length})</h3>
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto nx-scroll">
          {playlists.length === 0 ? <Empty msg="—" />
            : playlists.map((p: any, i: number) => (
              <a key={i} href={p.url} target="_blank" rel="noreferrer"
                 className="flex items-center gap-2 p-2 rounded hover:bg-elevated text-sm">
                <span className="text-xs text-muted-foreground w-6 tabular-nums">{i + 1}</span>
                <span className="flex-1 truncate">{p.nome}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{formatNumber(p.seguidores)}</span>
              </a>
            ))}
        </div>
      </div>
      <div className="nx-card p-5">
        <h3 className="font-bold mb-3">Faixas recorrentes ({tracks.length})</h3>
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto nx-scroll">
          {tracks.length === 0 ? <Empty msg="—" />
            : tracks.map((t: any, i: number) => (
              <div key={i} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="text-xs text-muted-foreground w-6 tabular-nums">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{t.nome}</div>
                  <div className="text-xs text-muted-foreground truncate">{t.artista}</div>
                </div>
                <span className="text-xs font-mono text-primary">×{t.count}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function Insights({ model, loading, onReload }: any) {
  if (loading) return <SkeletonGrid />;
  if (!model) return <Empty msg="Sem insights." />;
  const ai = model.insights?.ai;
  const kws = model.palavras_chave ?? [];
  const padroes = model.padroes_nome ?? [];

  return (
    <div className="space-y-4">
      {ai && (
        <div className="nx-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wand2 className="h-4 w-4 text-primary" />
            <h3 className="font-bold">Resumo IA</h3>
            <span className="ml-auto text-[10px] text-muted-foreground">gerado {timeAgo(ai.generated_at)}</span>
          </div>
          <p className="text-sm leading-relaxed">{ai.resumo || "—"}</p>
          {ai.tendencias?.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1.5">Tendências</div>
              <ul className="text-sm space-y-1">{ai.tendencias.map((s: string, i: number) => <li key={i}>• {s}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="nx-card p-5">
          <h3 className="font-bold mb-3 flex items-center gap-2"><Hash className="h-4 w-4 text-primary" /> Palavras-chave</h3>
          {kws.length === 0 ? <Empty msg="—" />
            : <div className="flex flex-wrap gap-1.5">
                {kws.slice(0, 30).map((k: any) => (
                  <span key={k.value} className="px-2 py-1 rounded-full bg-elevated border border-border text-xs">
                    {k.value} <span className="text-muted-foreground">·{k.count}</span>
                  </span>
                ))}
              </div>}
        </div>
        <div className="nx-card p-5">
          <h3 className="font-bold mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Padrões de nome</h3>
          {padroes.length === 0 ? <Empty msg="—" />
            : <div className="space-y-1.5">
                {padroes.slice(0, 15).map((p: any) => (
                  <div key={p.value} className="flex items-center justify-between text-sm">
                    <span className="truncate">{p.value}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{p.count}</span>
                  </div>
                ))}
              </div>}
        </div>
      </div>
    </div>
  );
}

function Visual({ briefing, loading, onAnalyze, analyzing }: any) {
  if (loading) return <SkeletonGrid />;
  const items = briefing?.briefings ?? [];
  const withDna = items.filter((b: any) => b.dna_capa);

  if (withDna.length === 0) {
    return (
      <div className="nx-card p-12 text-center space-y-3">
        <Palette className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">DNA visual ainda não foi extraído.</p>
        <Button size="sm" onClick={onAnalyze} disabled={analyzing || items.length === 0}>
          {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
          Analisar capas
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {withDna.map((b: any, i: number) => {
        const dna = b.dna_capa;
        return (
          <div key={i} className="nx-card p-5 space-y-3">
            <h4 className="font-bold text-sm">{b.nome}</h4>
            {dna.cores_dominantes?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1.5">Cores</div>
                <div className="flex gap-1.5">
                  {dna.cores_dominantes.map((c: string) => (
                    <div key={c} className="h-9 w-9 rounded-lg border border-border" style={{ backgroundColor: c }} title={c} />
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div><span className="text-muted-foreground">Estilo:</span> <span className="font-medium">{dna.estilo_dominante}</span></div>
              <div><span className="text-muted-foreground">Texto:</span> <span className="font-medium">{dna.uso_texto}</span></div>
              <div><span className="text-muted-foreground">Estrutura:</span> <span className="font-medium">{dna.estrutura_visual}</span></div>
              <div><span className="text-muted-foreground">Atmosfera:</span> <span className="font-medium">{dna.atmosfera}</span></div>
            </div>
            {dna.recomendacao_criacao && (
              <div className="text-xs p-2.5 rounded-lg bg-primary/5 border border-primary/20 text-foreground/85">
                <div className="text-[10px] uppercase text-primary font-bold mb-0.5 flex items-center gap-1"><FileText className="h-3 w-3" /> Recomendação</div>
                {dna.recomendacao_criacao}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ===================== HELPERS ===================== */

function Empty({ msg }: { msg: string }) {
  return <div className="text-xs text-muted-foreground py-8 text-center">{msg}</div>;
}

function SkeletonGrid() {
  // Reflete o layout real da Visão Geral: 3 KPIs em cima + bloco grande
  // Top playlists ao lado do Resumo do modelo. Sem skeleton "achatado" que
  // depois pula pra o tamanho real (causava sensação de "abre pequeno e expande").
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="nx-card p-4 h-[92px] animate-pulse" />
      <div className="nx-card p-4 h-[92px] animate-pulse" />
      <div className="nx-card p-4 h-[92px] animate-pulse" />
      <div className="nx-card p-5 lg:col-span-2 h-[440px] animate-pulse" />
      <div className="nx-card p-5 h-[440px] animate-pulse" />
    </div>
  );
}
