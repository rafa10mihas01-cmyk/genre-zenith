import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Loader2, Sparkles, ListMusic, Activity, Layers, Rocket,
} from "lucide-react";
import { useBrainModel } from "@/hooks/useBrainModel";
import { useBriefings } from "@/hooks/useBriefings";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Variacoes, Moldes } from "@/components/brain/Replicacao";
import { AutopilotLivePanel } from "@/components/brain/AutopilotLivePanel";
import { ReplicacaoAuto, ReplicacaoHistorico } from "@/components/brain/ReplicacaoAuto";
import { GenreHealthBanner } from "@/components/brain/GenreHealthBanner";
import { useScreenField } from "@/lib/screen-state";
import { useSetSidebarKpis } from "@/contexts/SidebarContext";
import { useAutopilot } from "@/hooks/useAutopilot";

import type { GenreOpt } from "@/components/cerebro/_shared";
import { GenreStrip, GenreHero, QuickActions, GenrePipeline, VisaoGeral } from "@/components/cerebro/VisaoGeral";
import { Decisoes } from "@/components/cerebro/Decisoes";
import { Coleta } from "@/components/cerebro/Coleta";
import { Base } from "@/components/cerebro/Base";
import { Insights, Section, CollapsibleSection } from "@/components/cerebro/Insights";
import { Visual } from "@/components/cerebro/Visual";

// Re-exporta helpers compartilhados pra manter compatibilidade com qualquer
// import externo eventual e centralizar o "ponto de entrada" do módulo.
export { Empty, SkeletonGrid, humanizeAttentionReason, type GenreOpt } from "@/components/cerebro/_shared";

/**
 * CÉREBRO — módulo único com 6 abas internas.
 * - /cerebro              → primeiro gênero analisado (default)
 * - /cerebro/:slug        → gênero específico
 *
 * Substitui as páginas antigas: BrainDetail, ModelDetail, Collect, Logs, Genres, Models.
 * Todo o conteúdo está migrado em abas. Sem duplicar arquivo, sem rotas extras.
 */

export default function Cerebro() {
  const { slug: paramSlug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const [genres, setGenres] = useState<GenreOpt[]>([]);
  const [activeSlug, setActiveSlug] = useState<string>(paramSlug ?? "");
  const [tab, setTab] = useScreenField<string>("/cerebro", "tab", "visao");
  const [running, setRunning] = useState(false);
  const [sbStats, setSbStats] = useState<{ active: number; analyzed: number; needsAttention: number } | null>(null);

  // Stats leves dedicadas pro sidebar (evita reaproveitar queries pesadas das abas)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [aRes, anRes, attRes] = await Promise.all([
        supabase.from("genres").select("id", { count: "exact", head: true }).eq("ativo", true),
        supabase.from("genre_models").select("id", { count: "exact", head: true }).not("ultima_analise", "is", null),
        supabase.from("genres").select("id", { count: "exact", head: true }).eq("needs_attention", true),
      ]);
      if (!cancelled) {
        setSbStats({
          active: aRes.count ?? 0,
          analyzed: anRes.count ?? 0,
          needsAttention: attRes.count ?? 0,
        });
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useSetSidebarKpis(
    sbStats
      ? [
          { label: "Gêneros ativos", value: sbStats.active, intent: "primary" },
          { label: "Analisados", value: sbStats.analyzed, intent: "success" },
          { label: "Problemas", value: sbStats.needsAttention, intent: sbStats.needsAttention > 0 ? "warning" : "default" },
        ]
      : [],
  );

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

  // ✅ Audit #15 — botão dispara o pipeline COMPLETO (genre-autopilot):
  // analyze-genre → briefing → blueprints → templates → covers.
  // Antes chamava brain-run (só análise) e gerava autopilot_runs "success" zeradas.
  const { isRunning: autopilotRunning, start: startAutopilot } = useAutopilot(genre?.id);

  const handleChangeGenre = (s: string) => {
    setActiveSlug(s);
    navigate(`/cerebro/${s}`);
  };

  const runBrain = async (force = false) => {
    if (!genre?.id || autopilotRunning || running) return;
    setRunning(true);
    try {
      await startAutopilot(5, { force });
    } finally {
      setRunning(false);
    }
  };

  if (genres.length === 0) {
    return (
      <div className="nx-card p-8 text-center">
        <Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">Carregando gêneros…</p>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Cérebro"
        subtitle="Analisar dados e gerar inteligência"
        actions={
          <div className="flex gap-2 min-w-0">
            <Button
              variant="outline"
              onClick={() => runBrain(true)}
              disabled={running || autopilotRunning || !genre?.id}
              className="nx-pill"
              title="Ignora o cooldown de 1h"
              aria-label="Forçar execução"
            >
              <span className="hidden xl:inline">Forçar execução</span>
            </Button>
            <Button onClick={() => runBrain(false)} disabled={running || autopilotRunning || !genre?.id} className="nx-pill max-w-full" aria-label="Atualizar inteligência">
              {(running || autopilotRunning) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span className="truncate">{autopilotRunning ? "Rodando..." : "Atualizar inteligência"}</span>
            </Button>
          </div>
        }
      />

      {/* PAINEL DE PROGRESSO AO VIVO — aparece quando autopilot está rodando */}
      <AutopilotLivePanel genreId={genre?.id} />

      {/* FAIXA DE GÊNEROS — chips coloridos com scroll horizontal */}
      <GenreStrip genres={genres} activeSlug={activeSlug} onPick={handleChangeGenre} />

      {/* HERO do gênero ativo — cor própria + KPIs grandes */}
      <GenreHero genre={genre} model={model} />

      {/* AVISO DE SAÚDE — visível quando dataset não está fresh */}
      <GenreHealthBanner
        status={genre?.health_status}
        lastSeenAt={genre?.health_last_seen_at}
        hoursSince={genre?.health_hours_since}
      />

      {/* AÇÕES RÁPIDAS — atalhos contextuais do gênero */}
      <QuickActions slug={activeSlug} />

      {/* MINI-PIPELINE — estado do gênero atual */}
      <GenrePipeline genre={genre} model={model} />


      {/* TABS — 6 áreas internas */}
      <Tabs value={tab} onValueChange={setTab} className="space-y-5">
        <TabsList className="sticky top-0 z-30 bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-md bg-transparent p-0 h-auto gap-4 sm:gap-6 border-b border-border rounded-none w-full justify-start nx-tabs-scroll flex-nowrap touch-pan-x overscroll-x-contain">
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
              className="bg-transparent rounded-none px-0 pb-3 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent border-b-2 border-transparent data-[state=active]:border-primary transition-colors shrink-0 whitespace-nowrap"
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
        <TabsContent value="replicacao" className="mt-0 space-y-6">
          {/* FUNIL: Moldes (origem) → Variações (geradas) → Histórico (publicadas) */}
          <Section step="1" icon={Layers} title="Moldes" subtitle="Padrões base — gere até 5 variações por molde">
            <Moldes genreId={genre?.id} />
          </Section>

          <Section step="2" icon={ListMusic} title="Variações" subtitle="Aprove e publique no Spotify">
            <Variacoes genreId={genre?.id} />
          </Section>

          <CollapsibleSection icon={Rocket} title="Replicar agora (atalho)" subtitle="Caminho rápido: top playlists → plano → despacha">
            <ReplicacaoAuto genreId={genre?.id} />
          </CollapsibleSection>

          <CollapsibleSection icon={Activity} title="Histórico" subtitle="Últimas replicações executadas">
            <ReplicacaoHistorico genreId={genre?.id} />
          </CollapsibleSection>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
