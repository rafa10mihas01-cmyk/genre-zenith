import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Brain, ArrowRight, Activity,
  Rocket, BarChart3,
  Target, Trophy, AlertTriangle, Sparkles, TrendingDown, Clock, ChevronRight,
  Search, ImageIcon,
} from "lucide-react";
import { formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { genreStyleVars } from "@/lib/genreColors";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { useSetSidebarKpis } from "@/contexts/SidebarContext";
import { computeSeoScore } from "@/lib/seoScore";
import { OperationalHealthCard } from "@/components/home/OperationalHealthCard";
import { WeeklySummaryCard } from "@/components/home/WeeklySummaryCard";
import { DealsPendingCard } from "@/components/home/DealsPendingCard";
import { BrainFreshnessCard } from "@/components/home/BrainFreshnessCard";
import { ProactiveAlertsCard } from "@/components/home/ProactiveAlertsCard";
import { ManagedPlaylistsKpis } from "@/components/home/ManagedPlaylistsKpis";
import { PlaylistsInDeclineCard } from "@/components/home/PlaylistsInDeclineCard";
import { ChevronDown } from "lucide-react";

/**
 * COCKPIT — foco em decisão, não em pipeline.
 * Filosofia: growth + otimização. IA recomenda, humano decide.
 */

type GenreRow = {
  id: string;
  slug: string;
  nome: string;
  status: string | null;
  total_playlists: number | null;
  total_musicas: number | null;
  ultima_coleta: string | null;
};

type Cockpit = {
  hotPending: number;
  mediumPending: number;
  topName: string | null;
  topGrowth: number | null;
  growingCount: number;
  decliningCount: number;
  totalPublished: number;
  withoutDataCount: number;
  pendingSuggestions: number;
  lastAnalysisAt: string | null;
};

type AttentionReason = "decline" | "stale" | "no_data" | "seo_low" | "old_cover";

type AttentionItem = {
  id: string;
  nome: string;
  reason: AttentionReason;
  detail: string;
  to: string;
};

type Suggestion = {
  tipo: string;
  playlist?: string;
  motivo: string;
  acao?: string;
  prioridade: string;
};

type ActivityRow = {
  id: string;
  acao: string;
  status: string;
  mensagem: string | null;
  created_at: string;
};

export default function Home() {
  const [c, setC] = useState<Cockpit | null>(null);
  const [genres, setGenres] = useState<GenreRow[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const staleThreshold = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    const oldCoverThreshold = new Date(Date.now() - 90 * 86400000).toISOString();

    const [
      gsRes,
      hotPendingRes,
      mediumPendingRes,
      perfRes,
      lowPerfRes,
      logsRes,
      lastInsightRes,
      seoRes,
      oldCoverRes,
    ] = await Promise.all([
      supabase
        .from("genres")
        .select("id,slug,nome,status,total_playlists,total_musicas,ultima_coleta")
        .order("total_playlists", { ascending: false, nullsFirst: false }),
      supabase.from("playlist_templates").select("*", { count: "exact", head: true })
        .eq("quality_tier", "hot").in("status", ["pending", "approved"]).is("spotify_playlist_id", null),
      supabase.from("playlist_templates").select("*", { count: "exact", head: true })
        .eq("quality_tier", "medium").in("status", ["pending", "approved"]).is("spotify_playlist_id", null),
      supabase.rpc("get_performance_dataset", { p_min_age_hours: 0 }),
      supabase.from("playlist_templates").select("*", { count: "exact", head: true })
        .eq("performance_class", "baixa"),
      supabase
        .from("collection_logs")
        .select("id,acao,status,mensagem,created_at")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("performance_insights")
        .select("created_at, acoes_sugeridas")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("playlist_templates")
        .select("id, name, description, cover_image_url, cover_generated_at, tracks_added")
        .not("spotify_playlist_id", "is", null)
        .limit(500),
      supabase
        .from("playlist_templates")
        .select("id, name")
        .not("spotify_playlist_id", "is", null)
        .lt("cover_generated_at", oldCoverThreshold)
        .limit(20),
    ]);

    type PerfRow = {
      template_id: string;
      nome: string;
      crescimento_absoluto: number | null;
      followers_now: number | null;
      last_snapshot_at: string | null;
    };
    const perfRows = (perfRes.data ?? []) as PerfRow[];
    const sorted = [...perfRows].sort(
      (a, b) => (b.crescimento_absoluto ?? 0) - (a.crescimento_absoluto ?? 0),
    );
    const top = sorted[0] ?? null;
    const growing = perfRows.filter(r => (r.crescimento_absoluto ?? 0) > 0).length;
    const declining = perfRows.filter(r => (r.crescimento_absoluto ?? 0) < 0).length;
    const withoutData = perfRows.filter(r => !r.followers_now || r.followers_now === 0).length;

    // Atenção hoje: quedas + dados velhos + SEO ruim + capa antiga + sem snapshot
    const att: AttentionItem[] = [];
    perfRows
      .filter(r => (r.crescimento_absoluto ?? 0) < 0)
      .sort((a, b) => (a.crescimento_absoluto ?? 0) - (b.crescimento_absoluto ?? 0))
      .slice(0, 3)
      .forEach(r => att.push({
        id: r.template_id,
        nome: r.nome,
        reason: "decline",
        detail: `${r.crescimento_absoluto} seguidores`,
        to: "/performance",
      }));
    perfRows
      .filter(r => r.last_snapshot_at && r.last_snapshot_at < staleThreshold && (r.followers_now ?? 0) > 0)
      .slice(0, 2)
      .forEach(r => att.push({
        id: r.template_id,
        nome: r.nome,
        reason: "stale",
        detail: `Sem coleta há ${timeAgo(r.last_snapshot_at!)}`,
        to: "/performance",
      }));

    // SEO baixo (score < 50) — usa heurística cliente-side
    const seoBadList: AttentionItem[] = [];
    for (const t of (seoRes.data ?? []) as any[]) {
      const r = computeSeoScore({
        name: t.name,
        description: t.description,
        cover_image_url: t.cover_image_url,
        cover_generated_at: t.cover_generated_at,
        tracks_added: t.tracks_added,
      });
      if (r.score < 50) {
        seoBadList.push({
          id: t.id,
          nome: t.name || "Sem nome",
          reason: "seo_low",
          detail: `SEO ${r.score}/100`,
          to: "/performance",
        });
      }
    }
    seoBadList.slice(0, 2).forEach(i => att.push(i));

    // Capa antiga (>90d)
    ((oldCoverRes.data ?? []) as any[]).slice(0, 2).forEach(t => att.push({
      id: t.id,
      nome: t.name || "Sem nome",
      reason: "old_cover",
      detail: "Capa com mais de 90 dias",
      to: "/performance",
    }));

    if (att.length < 5) {
      perfRows
        .filter(r => !r.followers_now || r.followers_now === 0)
        .slice(0, 5 - att.length)
        .forEach(r => att.push({
          id: r.template_id,
          nome: r.nome,
          reason: "no_data",
          detail: "Aguardando primeira coleta",
          to: "/performance",
        }));
    }

    const insightRow = lastInsightRes.data as { created_at: string; acoes_sugeridas: Suggestion[] } | null;
    const sugList = Array.isArray(insightRow?.acoes_sugeridas) ? insightRow!.acoes_sugeridas : [];
    const topSug = [...sugList]
      .sort((a, b) => prioRank(b.prioridade) - prioRank(a.prioridade))
      .slice(0, 4);

    setC({
      hotPending: hotPendingRes.count ?? 0,
      mediumPending: mediumPendingRes.count ?? 0,
      topName: top?.nome ?? null,
      topGrowth: top?.crescimento_absoluto ?? null,
      growingCount: growing,
      decliningCount: declining,
      totalPublished: perfRows.length,
      withoutDataCount: withoutData,
      pendingSuggestions: sugList.length,
      lastAnalysisAt: insightRow?.created_at ?? null,
    });
    setAttention(att);
    setSuggestions(topSug);
    setGenres((gsRes.data ?? []) as GenreRow[]);
    setActivity((logsRes.data ?? []) as ActivityRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  useSetSidebarKpis(
    c
      ? [
          { label: "Crescendo", value: c.growingCount, intent: "success" },
          { label: "Em queda", value: c.decliningCount, intent: c.decliningCount > 0 ? "warning" : "default" },
          { label: "Publicadas", value: c.totalPublished, intent: "primary" },
          { label: "Sugestões IA", value: c.pendingSuggestions, intent: c.pendingSuggestions > 0 ? "primary" : "default" },
        ]
      : [],
  );

  return (
    <>
      <PageHeader
        title="Hoje"
        subtitle="O que precisa de ação agora"
      />

      <PageContainer>
        {/* KPIs DAS MINHAS PLAYLISTS */}
      <ManagedPlaylistsKpis />

      {/* AÇÃO AGORA — playlists em queda + deals abertos */}
      <section className="space-y-3">
        <h2 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
          Ação agora
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PlaylistsInDeclineCard />
          <DealsPendingCard />
        </div>
      </section>

      {/* ALERTAS DOS CURADORES */}
      <section className="space-y-3">
        <h2 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
          Alertas dos curadores
        </h2>
        <ProactiveAlertsCard />
      </section>

      {/* RESUMO SEMANAL DAS MINHAS PLAYLISTS */}
      <section className="space-y-3">
        <h2 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
          Resumo semanal
        </h2>
        <WeeklySummaryCard />
      </section>

      {/* SAÚDE DO SISTEMA — compacto */}
      <section className="space-y-3">
        <h2 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
          Saúde do sistema
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <OperationalHealthCard />
          <BrainFreshnessCard />
        </div>
      </section>

      {/* MUNDO DE CRIAÇÃO AUTOMÁTICA — colapsado */}
      <details className="group nx-card overflow-hidden">
        <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between hover:bg-elevated/40 transition-colors">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
              Criação automática
            </span>
            <span className="text-sm font-medium text-foreground mt-0.5">
              Templates gerados pelo sistema
            </span>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>

        <div className="px-5 pb-5 pt-2 space-y-6 border-t border-border/50">
          {/* AÇÕES RÁPIDAS */}
          <section className="grid grid-cols-2 gap-3">
            <QuickAction
              to="/performance"
              icon={BarChart3}
              label="Performance"
              hint={c?.topName ? `Top: ${c.topName}` : "—"}
            />
            <QuickAction
              to="/criacao?tier=hot"
              icon={Rocket}
              label="Publicar prontos"
              hint={c ? `${c.hotPending} prontos` : "—"}
              highlight={!!c && c.hotPending > 0}
            />
          </section>

          {/* O QUE MUDOU (templates) */}
          <section className="space-y-3">
            <h2 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
              O que mudou (templates)
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <DecisionCard c={c} loading={loading} />
              <PerformanceCard c={c} loading={loading} />
            </div>
          </section>

          {/* PRECISA DE VOCÊ (templates) */}
          <section className="space-y-3">
            <h2 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
              Precisa de você (templates)
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <AttentionCard items={attention} loading={loading} />
              <SuggestionsCard suggestions={suggestions} total={c?.pendingSuggestions ?? 0} lastAt={c?.lastAnalysisAt ?? null} loading={loading} />
            </div>
          </section>

          {/* Gêneros */}
          <section className="space-y-3">
            <div className="flex items-end justify-between">
              <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-semibold">
                Gêneros
              </h2>
              <Button asChild variant="ghost" size="sm" className="rounded-full text-muted-foreground hover:text-foreground gap-1 h-7">
                <Link to="/cerebro">Ver tudo <ArrowRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </div>
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-[118px] rounded-2xl bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : genres.length === 0 ? (
              <div className="nx-card p-8 text-center">
                <Brain className="h-7 w-7 mx-auto text-muted-foreground" />
                <p className="mt-2 text-xs text-muted-foreground">Nenhum gênero cadastrado.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {genres.map(g => <GenreCard key={g.id} g={g} />)}
              </div>
            )}
          </section>

          {/* Atividade recente */}
          <section className="space-y-3">
            <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-semibold">
              Atividade recente
            </h2>
            <div className="nx-card overflow-hidden">
              {loading && activity.length === 0 && (
                <div className="p-6 text-center text-xs text-muted-foreground">Carregando…</div>
              )}
              {!loading && activity.length === 0 && (
                <div className="p-6 text-center text-xs text-muted-foreground">Sem atividade registrada.</div>
              )}
              <ul className="divide-y divide-border">
                {activity.map(l => {
                  const tone =
                    l.status === "sucesso" ? "text-primary bg-primary/10"
                    : l.status === "erro" ? "text-destructive bg-destructive/10"
                    : "text-warning bg-warning/10";
                  return (
                    <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                      <span className={cn("h-7 w-7 rounded-full flex items-center justify-center shrink-0", tone)}>
                        <Activity className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold leading-tight truncate">
                          {prettyAction(l.acao)}
                        </div>
                        {l.mensagem && (
                          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {l.mensagem}
                          </div>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                        {timeAgo(l.created_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </div>
      </details>
    </PageContainer>
  );
}

/* ============================================================
 * Subcomponentes
 * ============================================================ */

function prioRank(p: string): number {
  const v = (p || "").toLowerCase();
  if (v === "alta" || v === "high") return 3;
  if (v === "media" || v === "média" || v === "medium") return 2;
  return 1;
}

function QuickAction({
  to, icon: Icon, label, hint, highlight = false,
}: {
  to: string;
  icon: any;
  label: string;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "nx-card-hover p-3 sm:p-4 min-h-[86px] flex items-center gap-2.5 sm:gap-3 group overflow-hidden",
        highlight && "ring-1 ring-primary/40",
      )}
    >
      <div className={cn(
        "h-9 w-9 sm:h-10 sm:w-10 rounded-full flex items-center justify-center shrink-0 transition-colors",
        highlight ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground group-hover:text-foreground",
      )}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] sm:text-sm font-bold leading-tight line-clamp-2 break-words">{label}</div>
        {hint && hint !== "—" && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">{hint}</div>
        )}
      </div>
      <ArrowRight className="hidden sm:block h-4 w-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function DecisionCard({ c, loading }: { c: Cockpit | null; loading: boolean }) {
  const hot = c?.hotPending ?? 0;
  const med = c?.mediumPending ?? 0;
  const hasWork = hot + med > 0;

  return (
    <Link to="/criacao?tier=hot" className="nx-card-hover p-5 flex flex-col gap-4 group h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Decisão · O que fazer agora
          </span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>

      {loading ? (
        <div className="h-20 rounded-md bg-muted/40 animate-pulse" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="min-w-0">
              <div className="text-3xl font-bold tabular-nums leading-none text-primary">{hot}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Prontos</div>
            </div>
            <div className="min-w-0">
              <div className="text-3xl font-bold tabular-nums leading-none text-warning">{med}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Médios</div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {hasWork
              ? hot > 0
                ? "Há templates prontos para publicação imediata."
                : "Há templates aguardando aprovação."
              : "Sem ações pendentes — pipeline em dia."}
          </div>
        </>
      )}
    </Link>
  );
}

function PerformanceCard({ c, loading }: { c: Cockpit | null; loading: boolean }) {
  return (
    <Link to="/performance" className="nx-card-hover p-5 flex flex-col gap-4 group h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Performance · Resultado
          </span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>

      {loading ? (
        <div className="h-20 rounded-md bg-muted/40 animate-pulse" />
      ) : c?.topName ? (
        <>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Top playlist</div>
            <div className="text-lg font-bold leading-tight mt-1 truncate">{c.topName}</div>
            <div className={cn(
              "text-sm font-semibold tabular-nums mt-1",
              (c.topGrowth ?? 0) > 0 ? "text-primary" : "text-muted-foreground",
            )}>
              {(c.topGrowth ?? 0) > 0 ? "+" : ""}{formatNumber(c.topGrowth)} seguidores
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span><b className="text-foreground">{c.growingCount}</b> crescendo</span>
            {c.decliningCount > 0 && (
              <span className="text-destructive"><b>{c.decliningCount}</b> em queda</span>
            )}
          </div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground py-4">
          Sem dados de performance ainda. Publique uma playlist e aguarde 24h.
        </div>
      )}
    </Link>
  );
}

function AttentionCard({ items, loading }: { items: AttentionItem[]; loading: boolean }) {
  return (
    <div className="nx-card p-5 flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Atenção hoje
          </span>
        </div>
        {items.length > 0 && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{items.length}</span>
        )}
      </div>
      {loading ? (
        <div className="h-24 rounded-md bg-muted/40 animate-pulse" />
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4">
          Nenhuma playlist precisa de atenção. Catálogo saudável.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map(i => {
            const Icon =
              i.reason === "decline" ? TrendingDown
              : i.reason === "stale" ? Clock
              : i.reason === "seo_low" ? Search
              : i.reason === "old_cover" ? ImageIcon
              : Activity;
            const tone = i.reason === "decline" ? "text-destructive"
              : i.reason === "seo_low" || i.reason === "old_cover" ? "text-warning"
              : "text-muted-foreground";
            return (
              <li key={`${i.id}-${i.reason}`}>
                <Link to={i.to} className="flex items-center gap-3 -mx-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors group">
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", tone)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate leading-tight">{i.nome}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{i.detail}</div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SuggestionsCard({
  suggestions, total, lastAt, loading,
}: {
  suggestions: Suggestion[];
  total: number;
  lastAt: string | null;
  loading: boolean;
}) {
  return (
    <Link to="/performance?tab=insights" className="nx-card-hover p-5 flex flex-col gap-4 group h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Recomendações IA
          </span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      {loading ? (
        <div className="h-24 rounded-md bg-muted/40 animate-pulse" />
      ) : suggestions.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4">
          Nenhuma sugestão disponível. Rode uma análise em Performance.
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {suggestions.map((s, i) => {
              const high = prioRank(s.prioridade) === 3;
              return (
                <li key={i} className="flex items-start gap-2.5">
                  <span className={cn(
                    "mt-1 h-1.5 w-1.5 rounded-full shrink-0",
                    high ? "bg-primary" : "bg-muted-foreground",
                  )} />
                  <div className="min-w-0 flex-1">
                    {s.playlist && (
                      <div className="text-[11px] font-semibold truncate">{s.playlist}</div>
                    )}
                    <div className="text-xs text-muted-foreground line-clamp-2 leading-snug">
                      {s.acao || s.motivo}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="text-[10px] text-muted-foreground flex items-center justify-between pt-1 border-t border-border/50">
            <span>{total} sugestões no total</span>
            {lastAt && <span className="tabular-nums">há {timeAgo(lastAt)}</span>}
          </div>
        </>
      )}
    </Link>
  );
}

function GenreCard({ g }: { g: GenreRow }) {
  const initial = g.nome.slice(0, 1).toUpperCase();
  return (
    <Link
      to={`/cerebro/${g.slug}`}
      style={genreStyleVars(g.slug || g.nome)}
      className="nx-card-hover relative p-4 min-h-[118px] flex flex-col justify-between overflow-hidden group"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full opacity-40 group-hover:opacity-60 transition-opacity blur-2xl"
        style={{ background: "radial-gradient(closest-side, hsl(var(--g) / 0.55), transparent 70%)" }}
      />
      <div className="relative flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            style={{
              background: "linear-gradient(135deg, hsl(var(--g) / 0.35), hsl(var(--g) / 0.10))",
              border: "1px solid hsl(var(--g) / 0.45)",
              color: "hsl(var(--g))",
            }}
          >
            {initial}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-bold capitalize truncate leading-tight">{g.nome}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
              {g.status === "analisado" ? "Analisado" : "Pendente"}
            </div>
          </div>
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 shrink-0" />
      </div>
      <div className="relative flex items-end justify-between gap-2">
        <div>
          <div className="text-2xl font-bold tabular-nums leading-none" style={{ color: "hsl(var(--g))" }}>
            {formatNumber(g.total_playlists)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
            playlists{g.total_musicas ? ` • ${formatNumber(g.total_musicas)} faixas` : ""}
          </div>
        </div>
        {g.ultima_coleta && (
          <span className="text-[10px] text-muted-foreground tabular-nums">{timeAgo(g.ultima_coleta)}</span>
        )}
      </div>
    </Link>
  );
}

function prettyAction(a: string): string {
  const map: Record<string, string> = {
    "analyze-genre": "Análise de gênero",
    "collect-batch": "Coleta de playlists",
    "daily-collect": "Coleta diária",
    "enrich-playlists": "Enriquecimento",
    "generate-templates": "Geração de templates",
    "score-templates": "Reclassificação",
    "expire-stale-templates": "Limpeza de templates",
    "create-spotify-playlist": "Publicação no Spotify",
    "auto-replicate-playlists": "Replicação automática",
    "track-playlist-metrics": "Coleta de métricas",
    "learning-loop": "Aprendizado contínuo",
    "audit-brain": "Auditoria do Cérebro",
    "extract-blueprints": "Extração de padrões",
    "generate-cover-variations": "Geração de capas",
  };
  return map[a] ?? a.replace(/-/g, " ");
}
