import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Brain, Sparkles, Loader2, ListMusic, Music2, TrendingUp, Hash,
  ExternalLink, Image as ImageIcon, Palette, Wand2, FileText, Activity,
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

/* ===================== HEADER COMPONENTS (padrão Home) ===================== */

function GenreStrip({
  genres, activeSlug, onPick,
}: {
  genres: (GenreOpt & { total_playlists?: number | null })[];
  activeSlug: string;
  onPick: (slug: string) => void;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
          Gêneros
        </h2>
        <span className="text-[11px] text-muted-foreground">{genres.length} cadastrados</span>
      </div>
      <div className="flex gap-2 overflow-x-auto nx-scroll pb-1 -mx-1 px-1">
        {genres.map(g => {
          const active = g.slug === activeSlug;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => onPick(g.slug)}
              style={genreStyleVars(g.slug)}
              className={cn(
                "shrink-0 px-3.5 py-2 rounded-full border text-xs font-semibold capitalize transition-all flex items-center gap-2",
                active
                  ? "bg-[hsl(var(--g)/0.15)] border-[hsl(var(--g)/0.55)] text-foreground shadow-[0_0_0_1px_hsl(var(--g)/0.25)_inset,0_0_18px_-4px_hsl(var(--g)/0.45)]"
                  : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-[hsl(var(--g)/0.4)]",
              )}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: `hsl(var(--g))` }}
              />
              {g.nome}
              <span className="text-[10px] opacity-70 tabular-nums">
                {formatNumber(g.total_playlists ?? 0)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function GenreHero({ genre, model }: { genre: any; model: any }) {
  const slug = genre?.slug ?? "";
  const initials = (genre?.nome ?? slug).slice(0, 2).toUpperCase();
  return (
    <section
      style={genreStyleVars(slug)}
      className="nx-card p-5 flex flex-col md:flex-row md:items-center gap-5 relative overflow-hidden"
    >
      {/* glow sutil da cor */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08] pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 0% 50%, hsl(var(--g)) 0%, transparent 55%)",
        }}
      />
      <div
        className="relative h-16 w-16 rounded-2xl flex items-center justify-center text-2xl font-black text-foreground shrink-0 border"
        style={{
          background:
            "linear-gradient(135deg, hsl(var(--g)/0.35), hsl(var(--g)/0.05))",
          borderColor: "hsl(var(--g)/0.4)",
          boxShadow: "0 0 24px -8px hsl(var(--g)/0.5)",
        }}
      >
        {initials}
      </div>
      <div className="relative flex-1 min-w-0 space-y-1">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
          Gênero ativo
        </div>
        <h2 className="text-3xl font-black tracking-tight capitalize leading-none">
          {genre?.nome ?? "—"}
        </h2>
      </div>
      <div className="relative grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 md:min-w-[420px]">
        <HeroStat label="Playlists" value={formatNumber(genre?.total_playlists)} />
        <HeroStat label="Faixas" value={formatNumber(genre?.total_musicas)} />
        <HeroStat label="Termos" value={formatNumber(genre?.total_termos)} />
        <HeroStat
          label="Última análise"
          value={model?.ultima_analise ? timeAgo(model.ultima_analise) : "—"}
          small
        />
      </div>
    </section>
  );
}

function HeroStat({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 font-medium">
        {label}
      </div>
      <div className={cn("font-bold tabular-nums leading-tight mt-0.5", small ? "text-sm" : "text-xl")}>
        {value}
      </div>
    </div>
  );
}

function QuickActions({ slug }: { slug: string }) {
  if (!slug) return null;
  const items = [
    { to: `/criacao?genre=${slug}`, icon: Wrench, label: "Ver templates", hint: "Templates deste gênero" },
    { to: `/performance?genre=${slug}`, icon: BarChart3, label: "Ver performance", hint: "Crescimento e ranking" },
    { to: `/operacao?genre=${slug}`, icon: Radio, label: "Ver publicadas", hint: "Playlists no Spotify" },
  ];
  return (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {items.map(it => (
        <Link
          key={it.to}
          to={it.to}
          className="nx-card-hover p-4 flex items-center gap-3 group transition-all"
        >
          <div className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 bg-muted text-muted-foreground group-hover:text-foreground transition-colors">
            <it.icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold leading-tight">{it.label}</div>
            <div className="text-[11px] text-muted-foreground truncate mt-0.5">{it.hint}</div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
        </Link>
      ))}
    </section>
  );
}

function GenrePipeline({ genre, model }: { genre: any; model: any }) {
  const collected = genre?.total_playlists ?? 0;
  const analyzed = !!model?.ultima_analise;
  const palavras = (model?.palavras_chave ?? []).length;
  const padroes = (model?.padroes_nome ?? []).length;
  const briefingReady = palavras > 0 || padroes > 0;

  const steps = [
    {
      icon: Search,
      title: "Coletado",
      primary: collected > 0 ? `${formatNumber(collected)} playlists` : "Sem coleta",
      sub: genre?.ultima_coleta ? `Última: ${timeAgo(genre.ultima_coleta)}` : "—",
      ok: collected > 0,
    },
    {
      icon: Lightbulb,
      title: "Analisado",
      primary: analyzed ? "Modelo gerado" : "Pendente",
      sub: analyzed ? `Atualizado ${timeAgo(model.ultima_analise)}` : "Rode 'Atualizar inteligência'",
      ok: analyzed,
    },
    {
      icon: FileText,
      title: "Inteligência",
      primary: briefingReady ? `${palavras} palavras-chave` : "—",
      sub: briefingReady ? `${padroes} padrões de nome` : "Sem extração",
      ok: briefingReady,
    },
    {
      icon: Rocket,
      title: "Pronto p/ criação",
      primary: briefingReady && analyzed ? "Gerar templates" : "Aguardando",
      sub: briefingReady && analyzed ? "Vá para Decisões" : "Complete análise primeiro",
      ok: briefingReady && analyzed,
    },
  ];

  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold mb-2">
        Pipeline do gênero
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map((s, i) => (
          <div key={i} className="nx-card p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center",
                s.ok ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
              )}>
                <s.icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                {s.title}
              </span>
            </div>
            <div className="text-sm font-bold leading-tight truncate">{s.primary}</div>
            <div className="text-[11px] text-muted-foreground truncate">{s.sub}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ===================== HELPERS DE LOGS (Coleta) ===================== */

/** Mapeia o nome técnico da função para um título humano + ícone + descrição curta. */
const ACTION_META: Record<
  string,
  { title: string; desc: string; icon: any }
> = {
  "analyze-genre":          { title: "Análise de gênero",        desc: "Modelo aprendeu padrões da base",   icon: Lightbulb },
  "analyze-visual-dna":     { title: "Análise visual",           desc: "Identificou estilo das capas",      icon: Palette },
  "analyze-genre-visual-dna":{ title: "Análise visual",          desc: "Identificou estilo das capas",      icon: Palette },
  "genre-insights":         { title: "Resumo da IA",             desc: "Tendências e oportunidades",        icon: Wand2 },
  "create-spotify-playlist":{ title: "Playlist publicada",       desc: "Nova playlist enviada ao Spotify",  icon: Rocket },
  "generate-templates":     { title: "Templates gerados",        desc: "Variações criadas a partir do blueprint", icon: FileText },
  "extract-blueprints":     { title: "Blueprints extraídos",     desc: "Padrões fortes consolidados",       icon: Sparkles },
  "extract-replication-rules":{ title: "Regras aprendidas",      desc: "Aprendizados do que dá resultado",  icon: Sparkles },
  "replicate-top":          { title: "Replicação top",           desc: "Pacote das melhores playlists",     icon: Radio },
  "auto-replicate-playlists":{ title: "Replicação automática",   desc: "Sistema replicou sozinho",          icon: Radio },
  "auto-adjust-playlists":  { title: "Ajuste automático",        desc: "Sistema corrigiu playlists",        icon: Wrench },
  "enrich-playlists":       { title: "Enriquecimento",           desc: "Buscou seguidores e faixas",        icon: TrendingUp },
  "fetch-tracks-spotify":   { title: "Coleta de faixas",         desc: "Faixas das playlists baixadas",     icon: Music2 },
  "collect-batch":          { title: "Coleta em lote",           desc: "Lote de playlists coletado",        icon: Search },
  "daily-collect":          { title: "Coleta diária",            desc: "Rotina diária de descoberta",       icon: Search },
  "run-search":             { title: "Busca por termo",          desc: "Termo executado no Spotify",        icon: Search },
  "fetch-spotify-featured": { title: "Destaques Spotify",        desc: "Playlists em destaque coletadas",   icon: Search },
  "score-templates":        { title: "Score de templates",       desc: "Recalculou pontuação",              icon: TrendingUp },
  "track-playlist-metrics": { title: "Métricas das playlists",   desc: "Snapshot de seguidores",            icon: TrendingUp },
  "audit-brain":            { title: "Auditoria do sistema",     desc: "Verificação de saúde",              icon: Activity },
  "cleanup-brain":          { title: "Limpeza do sistema",       desc: "Removeu dados obsoletos",           icon: Activity },
  "learning-loop":          { title: "Ciclo de aprendizado",     desc: "Iteração completa do sistema",      icon: Brain },
  "generate-cover-variations":{ title: "Variações de capa",      desc: "Gerou opções de capa",              icon: ImageIcon },
  "upload-playlist-cover":  { title: "Capa enviada",             desc: "Capa aplicada na playlist",         icon: ImageIcon },
  "generate-playlists-briefing":{ title: "Briefing de criação",  desc: "Briefing pronto p/ produzir",       icon: FileText },
  "seed-editorial-terms":   { title: "Termos editoriais",        desc: "Sementes de busca semeadas",        icon: Hash },
  "generate-terms":         { title: "Geração de termos",        desc: "Novos termos sugeridos pela IA",    icon: Hash },
  "expire-stale-templates": { title: "Expiração de templates",   desc: "Templates velhos arquivados",       icon: Activity },
  "revalidate-dataset":     { title: "Revalidação",              desc: "Base reconferida",                  icon: Activity },
  "spotify-auth":           { title: "Conexão Spotify",          desc: "Token renovado",                    icon: Activity },
};

function actionMeta(acao: string) {
  return ACTION_META[acao] ?? {
    title: acao.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    desc: "—",
    icon: Activity,
  };
}

/** Limpa a mensagem técnica: corta JSON, remove `[global]`, encurta duração. */
function cleanLogMessage(msg: string | null): string {
  if (!msg) return "";
  let out = String(msg);
  // Remove prefixos tipo "[global] " ou "[piseiro] "
  out = out.replace(/^\[[^\]]+\]\s*/, "");
  // Se tem JSON gigante no meio, corta antes do primeiro "{"
  const firstBrace = out.indexOf("{");
  if (firstBrace > 0 && out.length - firstBrace > 80) {
    out = out.slice(0, firstBrace).trim().replace(/[|·•]\s*$/, "").trim();
  }
  // Limita tamanho
  if (out.length > 180) out = out.slice(0, 177).trim() + "…";
  return out;
}

function statusLabel(status: string) {
  if (status === "sucesso") return { label: "OK", cls: "bg-primary/15 text-primary" };
  if (status === "erro")    return { label: "Erro", cls: "bg-destructive/15 text-destructive" };
  return { label: "Aviso", cls: "bg-warning/15 text-warning" };
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
        <KpiBig icon={Activity} label="Eventos recentes" value={String(logs.length)} hint="Últimas 40 ações" />
        <KpiBig icon={Music2} label="Aguardando enriquecer" value={String(pending)} hint="Playlists sem dados completos" />
        <div className="nx-card p-4 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Ação</div>
            <div className="text-sm font-bold mt-0.5">Enriquecer agora</div>
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
              Busca seguidores e faixas das pendentes
            </div>
          </div>
          <Button size="sm" onClick={runEnrich} disabled={enriching || !genreId || pending === 0}>
            {enriching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Rodar
          </Button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
            Histórico de ações
          </h3>
          <span className="text-[11px] text-muted-foreground">{logs.length} eventos</span>
        </div>
        <div className="nx-card overflow-hidden">
          {logs.length === 0 ? (
            <div className="p-8"><Empty msg="Sem atividade registrada para este gênero." /></div>
          ) : (
            <ul className="divide-y divide-border max-h-[60vh] overflow-y-auto nx-scroll">
              {logs.map(l => <LogRow key={l.id} log={l} />)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function LogRow({ log }: { log: any }) {
  const [open, setOpen] = useState(false);
  const meta = actionMeta(log.acao);
  const st = statusLabel(log.status);
  const Icon = meta.icon;
  const message = cleanLogMessage(log.mensagem);
  const hasDetails = !!log.mensagem && log.mensagem.length > 60;

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span className={cn(
          "h-9 w-9 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          log.status === "sucesso" ? "bg-primary/10 text-primary"
          : log.status === "erro" ? "bg-destructive/10 text-destructive"
          : "bg-warning/10 text-warning",
        )}>
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold leading-tight">{meta.title}</span>
            <span className={cn("text-[10px] uppercase font-bold px-1.5 py-0.5 rounded", st.cls)}>
              {st.label}
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">
              {timeAgo(log.created_at)}
              {log.duracao_ms != null && <span className="ml-2 opacity-70">{(log.duracao_ms / 1000).toFixed(1)}s</span>}
            </span>
          </div>

          <p className="text-[13px] text-foreground/85 mt-1 leading-snug">
            {message || meta.desc}
          </p>

          {hasDetails && (
            <button
              type="button"
              onClick={() => setOpen(o => !o)}
              className="mt-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
            >
              {open ? "Ocultar detalhes" : "Ver detalhes técnicos"}
              <ArrowRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
            </button>
          )}

          {open && (
            <pre className="mt-2 text-[11px] text-muted-foreground bg-elevated/60 border border-border rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono">
              {log.mensagem}
              {"\n\n"}
              <span className="text-foreground/50">acao: {log.acao} · {formatDate(log.created_at)}</span>
            </pre>
          )}
        </div>
      </div>
    </li>
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

function Insights({ model, loading }: any) {
  if (loading) return <SkeletonGrid />;
  if (!model) return <Empty msg="Sem insights." />;

  const ai = model.insights?.ai;
  const kws: { value: string; count: number }[] = model.palavras_chave ?? [];
  const padroes: { value: string; count: number }[] = model.padroes_nome ?? [];
  const tendencias: string[] = ai?.tendencias ?? [];
  const oportunidades: string[] = ai?.oportunidades_seo ?? ai?.oportunidades ?? [];
  const sugestoesNomes: string[] = ai?.sugestoes_nomes ?? ai?.sugestoes ?? [];

  const topKws = [...kws].sort((a, b) => b.count - a.count).slice(0, 24);
  const maxKw = topKws[0]?.count ?? 1;
  const topPadroes = [...padroes].sort((a, b) => b.count - a.count).slice(0, 12);

  return (
    <div className="space-y-6">
      {/* FASE 1 — RESUMO */}
      {ai?.resumo && (
        <Section
          step="1"
          icon={Wand2}
          title="O que a IA aprendeu"
          subtitle={ai.generated_at ? `Atualizado ${timeAgo(ai.generated_at)}` : undefined}
        >
          <p className="text-[15px] leading-relaxed text-foreground/90">{ai.resumo}</p>
        </Section>
      )}

      {/* FASE 2 — TENDÊNCIAS + OPORTUNIDADES (lado a lado) */}
      {(tendencias.length > 0 || oportunidades.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {tendencias.length > 0 && (
            <Section step="2" icon={TrendingUp} title="Tendências" subtitle={`${tendencias.length} sinais`}>
              <BulletList items={tendencias} tone="primary" />
            </Section>
          )}
          {oportunidades.length > 0 && (
            <Section step="3" icon={Lightbulb} title="Oportunidades" subtitle={`${oportunidades.length} ideias`}>
              <BulletList items={oportunidades} tone="warning" />
            </Section>
          )}
        </div>
      )}

      {/* FASE 3 — VOCABULÁRIO (palavras-chave com barras) */}
      {topKws.length > 0 && (
        <Section
          step="4"
          icon={Hash}
          title="Vocabulário do gênero"
          subtitle={`${kws.length} palavras • mostrando top ${topKws.length}`}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-1.5">
            {topKws.map(k => (
              <KeywordBar key={k.value} label={k.value} count={k.count} max={maxKw} />
            ))}
          </div>
        </Section>
      )}

      {/* FASE 4 — PADRÕES + SUGESTÕES DE NOMES */}
      {(topPadroes.length > 0 || sugestoesNomes.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {topPadroes.length > 0 && (
            <Section step="5" icon={Sparkles} title="Padrões de nome" subtitle="Combinações mais usadas">
              <ul className="divide-y divide-border -mx-1">
                {topPadroes.map((p, i) => (
                  <li key={p.value} className="flex items-center justify-between py-2 px-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] text-muted-foreground tabular-nums w-5">{i + 1}</span>
                      <span className="text-sm font-medium truncate">{p.value}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{p.count}×</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {sugestoesNomes.length > 0 && (
            <Section
              step="6"
              icon={FileText}
              title="Nomes sugeridos pela IA"
              subtitle={`${sugestoesNomes.length} ideias prontas`}
            >
              <ul className="space-y-1.5">
                {sugestoesNomes.map((n, i) => (
                  <li
                    key={i}
                    className="text-sm px-3 py-2 rounded-lg bg-elevated/50 border border-border/60 text-foreground/90"
                  >
                    {n}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- subcomponentes da aba Insights ---------- */

function Section({
  step, icon: Icon, title, subtitle, children,
}: {
  step?: string;
  icon: any;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="nx-card p-5">
      <header className="flex items-center gap-3 mb-4">
        <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {step && (
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
                Fase {step}
              </span>
            )}
          </div>
          <h3 className="text-base font-bold leading-tight">{title}</h3>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
      </header>
      {children}
    </section>
  );
}

function BulletList({ items, tone = "primary" }: { items: string[]; tone?: "primary" | "warning" }) {
  const dot = tone === "warning" ? "bg-warning" : "bg-primary";
  return (
    <ul className="space-y-2.5">
      {items.map((s, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-foreground/90">
          <span className={cn("mt-[7px] h-1.5 w-1.5 rounded-full shrink-0", dot)} />
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

function KeywordBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = Math.max(8, Math.round((count / max) * 100));
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-sm font-medium truncate flex-1">{label}</span>
      <div className="w-24 h-1.5 rounded-full bg-elevated overflow-hidden shrink-0">
        <div className="h-full bg-primary/70 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums w-7 text-right shrink-0">{count}</span>
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

  // ===== Consolidação: DNA dominante do gênero (agregado) =====
  const colorFreq = new Map<string, number>();
  const styleFreq = new Map<string, number>();
  const textFreq = new Map<string, number>();
  const structureFreq = new Map<string, number>();
  const moodFreq = new Map<string, number>();

  withDna.forEach((b: any) => {
    const dna = b.dna_capa;
    (dna.cores_dominantes ?? []).forEach((c: string) => {
      const norm = c.toLowerCase();
      colorFreq.set(norm, (colorFreq.get(norm) ?? 0) + 1);
    });
    if (dna.estilo_dominante) styleFreq.set(dna.estilo_dominante, (styleFreq.get(dna.estilo_dominante) ?? 0) + 1);
    if (dna.uso_texto) textFreq.set(dna.uso_texto, (textFreq.get(dna.uso_texto) ?? 0) + 1);
    if (dna.estrutura_visual) structureFreq.set(dna.estrutura_visual, (structureFreq.get(dna.estrutura_visual) ?? 0) + 1);
    if (dna.atmosfera) moodFreq.set(dna.atmosfera, (moodFreq.get(dna.atmosfera) ?? 0) + 1);
  });

  const topColors = [...colorFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
  const topOf = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  return (
    <div className="space-y-6">
      {/* ===== FASE 1 — DNA visual dominante ===== */}
      <Section step="1" icon={Palette} title="DNA visual dominante" subtitle={`Padrão consolidado a partir de ${withDna.length} capas analisadas`}>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Paleta dominante - ocupa 2 colunas */}
          <div className="lg:col-span-2 space-y-2">
            <div className="text-[10px] uppercase text-muted-foreground tracking-wider font-semibold">Paleta dominante</div>
            <div className="flex flex-wrap gap-2">
              {topColors.map(c => (
                <div key={c} className="flex flex-col items-center gap-1">
                  <div className="h-12 w-12 rounded-lg border border-border shadow-sm" style={{ backgroundColor: c }} title={c} />
                  <span className="text-[9px] font-mono text-muted-foreground uppercase">{c.replace("#", "")}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Atributos consolidados */}
          <div className="lg:col-span-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <DnaAttr label="Estilo" value={topOf(styleFreq)} />
            <DnaAttr label="Texto" value={topOf(textFreq)} />
            <DnaAttr label="Estrutura" value={topOf(structureFreq)} />
            <DnaAttr label="Atmosfera" value={topOf(moodFreq)} />
          </div>
        </div>
      </Section>

      {/* ===== FASE 2 — DNA por playlist ===== */}
      <Section phase={2} icon={ImageIcon} title="DNA por playlist" subtitle={`${withDna.length} análises individuais`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {withDna.map((b: any, i: number) => {
            const dna = b.dna_capa;
            return (
              <div key={i} className="nx-card p-5 space-y-4">
                <h4 className="font-semibold text-sm leading-tight">{b.nome}</h4>

                {dna.cores_dominantes?.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] uppercase text-muted-foreground tracking-wider font-semibold">Cores</div>
                    <div className="flex gap-1.5">
                      {dna.cores_dominantes.map((c: string) => (
                        <div key={c} className="h-8 w-8 rounded-md border border-border" style={{ backgroundColor: c }} title={c} />
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs pt-1 border-t border-border/50">
                  <DnaRow label="Estilo" value={dna.estilo_dominante} />
                  <DnaRow label="Texto" value={dna.uso_texto} />
                  <DnaRow label="Estrutura" value={dna.estrutura_visual} />
                  <DnaRow label="Atmosfera" value={dna.atmosfera} />
                </div>

                {dna.recomendacao_criacao && (
                  <div className="text-xs p-3 rounded-lg bg-primary/5 border border-primary/20 text-foreground/90 leading-relaxed">
                    <div className="text-[10px] uppercase text-primary font-bold mb-1 flex items-center gap-1">
                      <FileText className="h-3 w-3" /> Recomendação para criação
                    </div>
                    {dna.recomendacao_criacao}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function DnaAttr({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider font-semibold">{label}</div>
      <div className="text-sm font-semibold text-foreground capitalize">{value}</div>
    </div>
  );
}

function DnaRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className="text-xs font-medium text-foreground/90 capitalize leading-tight">{value ?? "—"}</div>
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
