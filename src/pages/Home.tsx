import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Brain, ArrowRight, Activity,
  Rocket, Image as ImageIcon, BarChart3,
  Search, Lightbulb, Target, Wrench, Radio, Trophy,
} from "lucide-react";
import { formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { genreStyleVars } from "@/lib/genreColors";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { useSetSidebarKpis } from "@/contexts/SidebarContext";

/**
 * HOME — Cockpit do sistema, organizado pelo PIPELINE:
 * Ações rápidas → Decisão + Performance (above the fold)
 * → Strip Descoberta/Inteligência/Criação/Publicação
 * → Lista compacta de gêneros
 * → Atividade recente
 *
 * 100% dados reais. Tudo clicável vai pro lugar certo.
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
  // Descoberta
  totalPlaylists: number;
  activeGenres: number;
  newPlaylists24h: number;
  // Inteligência
  totalGenres: number;
  analyzedGenres: number;
  lastAnalysisAt: string | null;
  // Decisão
  hotPending: number;
  mediumPending: number;
  newOpportunities: number; // templates hot/medium criados nas últimas 24h sem ação
  // Criação
  queueTotal: number;
  hotNoCover: number;
  // Publicação
  published: number;
  activeAccounts: number;
  // Performance
  topName: string | null;
  topGrowth: number | null;
  growingCount: number;
  lowPerfCount: number;
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
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const [
      gsRes,
      modelsRes,
      totalGenresRes,
      analyzedRes,
      totalPlaylistsRes,
      activeGenresRes,
      newPlaylists24hRes,
      hotPendingRes,
      mediumPendingRes,
      newOppRes,
      hotNoCoverRes,
      queueTotalRes,
      publishedRes,
      activeAccountsRes,
      perfRes,
      lowPerfRes,
      logsRes,
      lastAnalysisRes,
    ] = await Promise.all([
      supabase
        .from("genres")
        .select("id,slug,nome,status,total_playlists,total_musicas,ultima_coleta")
        .order("total_playlists", { ascending: false, nullsFirst: false }),
      supabase.from("genre_models").select("genre_id"),
      supabase.from("genres").select("*", { count: "exact", head: true }),
      supabase.from("genres").select("*", { count: "exact", head: true }).eq("status", "analisado"),
      supabase.from("search_results").select("*", { count: "exact", head: true }),
      supabase.from("genres").select("*", { count: "exact", head: true }).eq("ativo", true),
      supabase.from("search_results").select("*", { count: "exact", head: true }).gte("first_seen_at", since24h),
      supabase.from("playlist_templates").select("*", { count: "exact", head: true })
        .eq("quality_tier", "hot").in("status", ["pending", "approved"]).is("spotify_playlist_id", null),
      supabase.from("playlist_templates").select("*", { count: "exact", head: true })
        .eq("quality_tier", "medium").in("status", ["pending", "approved"]).is("spotify_playlist_id", null),
      supabase.from("playlist_templates").select("*", { count: "exact", head: true })
        .in("quality_tier", ["hot", "medium"]).in("status", ["pending", "approved"])
        .is("spotify_playlist_id", null).gte("created_at", since24h),
      supabase.from("playlist_templates").select("*", { count: "exact", head: true })
        .eq("quality_tier", "hot").in("status", ["pending", "approved"]).is("spotify_playlist_id", null)
        .or("cover_image_url.is.null,cover_selected_index.is.null"),
      supabase.from("playlist_templates").select("*", { count: "exact", head: true })
        .in("quality_tier", ["hot", "medium"]).in("status", ["pending", "approved"]).is("spotify_playlist_id", null),
      supabase.from("playlist_templates").select("*", { count: "exact", head: true })
        .not("spotify_playlist_id", "is", null),
      supabase.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active"),
      supabase.rpc("get_performance_dataset", { p_min_age_hours: 24 }),
      supabase.from("playlist_templates").select("*", { count: "exact", head: true })
        .eq("performance_class", "baixa"),
      supabase
        .from("collection_logs")
        .select("id,acao,status,mensagem,created_at")
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("genre_models")
        .select("ultima_analise")
        .order("ultima_analise", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
    ]);

    // Top performance
    const perfRows = (perfRes.data ?? []) as Array<{ nome: string; crescimento_absoluto: number | null }>;
    const sorted = [...perfRows].sort(
      (a, b) => (b.crescimento_absoluto ?? 0) - (a.crescimento_absoluto ?? 0),
    );
    const top = sorted[0] ?? null;
    const growing = perfRows.filter(r => (r.crescimento_absoluto ?? 0) > 0).length;

    setC({
      totalPlaylists: totalPlaylistsRes.count ?? 0,
      activeGenres: activeGenresRes.count ?? 0,
      newPlaylists24h: newPlaylists24hRes.count ?? 0,
      totalGenres: totalGenresRes.count ?? 0,
      analyzedGenres: analyzedRes.count ?? 0,
      lastAnalysisAt: (lastAnalysisRes.data as { ultima_analise: string | null } | null)?.ultima_analise ?? null,
      hotPending: hotPendingRes.count ?? 0,
      mediumPending: mediumPendingRes.count ?? 0,
      newOpportunities: newOppRes.count ?? 0,
      queueTotal: queueTotalRes.count ?? 0,
      hotNoCover: hotNoCoverRes.count ?? 0,
      published: publishedRes.count ?? 0,
      activeAccounts: activeAccountsRes.count ?? 0,
      topName: top?.nome ?? null,
      topGrowth: top?.crescimento_absoluto ?? null,
      growingCount: growing,
      lowPerfCount: lowPerfRes.count ?? 0,
    });

    setGenres((gsRes.data ?? []) as GenreRow[]);
    setActivity((logsRes.data ?? []) as ActivityRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  // Alimenta sidebar smart panel: prontos / médios / total
  useSetSidebarKpis(
    c
      ? [
          { label: "Prontos", value: c.hotPending, intent: "primary" },
          { label: "Médios", value: c.mediumPending, intent: "warning" },
          { label: "Publicadas", value: c.published, intent: "success" },
          { label: "Total playlists", value: c.totalPlaylists, intent: "default" },
        ]
      : [],
  );

  return (
    <PageContainer>
      <PageHeader
        title="Cockpit"
        subtitle="Acompanhe o pipeline e tome decisões rápidas"
      />

      {/* AÇÕES RÁPIDAS — sempre visível, decide tudo */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <QuickAction
          to="/criacao?tier=hot"
          icon={Rocket}
          label="Publicar melhores"
          hint={c ? `${c.hotPending} prontos` : "—"}
          highlight={!!c && c.hotPending > 0}
        />
        <QuickAction
          to="/criacao?tier=hot&filter=no-cover"
          icon={ImageIcon}
          label="Revisar capas"
          hint={c ? `${c.hotNoCover} sem capa` : "—"}
          highlight={!!c && c.hotNoCover > 0}
        />
        <QuickAction
          to="/performance"
          icon={BarChart3}
          label="Ver performance"
          hint={c?.topName ? `Top: ${c.topName}` : "—"}
        />
      </section>

      {/* DECISÃO + PERFORMANCE — above the fold, lado a lado */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DecisionCard c={c} loading={loading} />
        <PerformanceCard c={c} loading={loading} />
      </section>

      {/* PIPELINE STRIP — Descoberta → Inteligência → Criação → Publicação */}
      <section>
        <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-semibold mb-3">
          Pipeline
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <PipelineCard
            to="/cerebro"
            icon={Search}
            step="1"
            title="Descoberta"
            primary={loading ? "—" : `${formatNumber(c?.totalPlaylists)} playlists`}
            sub={
              loading
                ? "Carregando..."
                : `${c?.activeGenres ?? 0} gêneros ativos${
                    (c?.newPlaylists24h ?? 0) > 0 ? ` • +${c?.newPlaylists24h} hoje` : ""
                  }`
            }
          />
          <PipelineCard
            to="/cerebro"
            icon={Lightbulb}
            step="2"
            title="Inteligência"
            primary={loading ? "—" : `${c?.analyzedGenres ?? 0}/${c?.totalGenres ?? 0} analisados`}
            sub={
              loading
                ? "Carregando..."
                : c?.lastAnalysisAt
                ? `Atualizado ${timeAgo(c.lastAnalysisAt)}`
                : "Sem análises ainda"
            }
          />
          <PipelineCard
            to="/criacao"
            icon={Wrench}
            step="4"
            title="Criação"
            primary={loading ? "—" : `${c?.queueTotal ?? 0} na fila`}
            sub={
              loading
                ? "Carregando..."
                : (c?.hotNoCover ?? 0) > 0
                ? `${c?.hotNoCover} sem capa`
                : "Capas em dia"
            }
          />
          <PipelineCard
            to="/operacao"
            icon={Radio}
            step="5"
            title="Publicação"
            primary={loading ? "—" : `${c?.published ?? 0} publicadas`}
            sub={loading ? "Carregando..." : `${c?.activeAccounts ?? 0} contas ativas`}
          />
        </div>
      </section>

      {/* Gêneros — cards grandes coloridos (identidade do sistema) */}
      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-semibold">
              Gêneros
            </h2>
            <p className="text-[11px] text-muted-foreground mt-1">
              {loading ? "Carregando..." : `${genres.length} cadastrados • clique para abrir o Cérebro`}
            </p>
          </div>
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

      {/* Atividade recente — limpa, com ícone colorido e mensagem suave */}
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
    </PageContainer>
  );
}

/* ============================================================
 * Subcomponentes
 * ============================================================ */

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
        "nx-card-hover p-4 flex items-center gap-3 group",
        highlight && "ring-1 ring-primary/40",
      )}
    >
      <div className={cn(
        "h-10 w-10 rounded-full flex items-center justify-center shrink-0 transition-colors",
        highlight ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground group-hover:text-foreground",
      )}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold leading-tight">{label}</div>
        <div className="text-[11px] text-muted-foreground truncate mt-0.5">{hint}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function DecisionCard({ c, loading }: { c: Cockpit | null; loading: boolean }) {
  const hot = c?.hotPending ?? 0;
  const med = c?.mediumPending ?? 0;
  const opp = c?.newOpportunities ?? 0;
  const hasWork = hot + med > 0;

  return (
    <Link to="/criacao?tier=hot" className="nx-card-hover p-5 flex flex-col gap-4 group">
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
          <div className="flex items-end gap-6">
            <div>
              <div className="text-3xl font-bold tabular-nums leading-none flex items-baseline gap-1">
                <span className="text-primary">🔥</span>{hot}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1.5">Prontos</div>
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums leading-none flex items-baseline gap-1 text-warning">
                ⚠️{med}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1.5">Médios</div>
            </div>
            {opp > 0 && (
              <div className="ml-auto">
                <div className="text-2xl font-bold tabular-nums leading-none">+{opp}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1.5">Oportunidades 24h</div>
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {hasWork
              ? hot > 0
                ? "Há templates 🔥 prontos para publicação imediata."
                : "Há templates ⚠️ aguardando aprovação."
              : "Sem ações pendentes — pipeline em dia."}
          </div>
        </>
      )}
    </Link>
  );
}

function PerformanceCard({ c, loading }: { c: Cockpit | null; loading: boolean }) {
  return (
    <Link to="/performance" className="nx-card-hover p-5 flex flex-col gap-4 group">
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
            {c.lowPerfCount > 0 && (
              <span className="text-destructive"><b>{c.lowPerfCount}</b> em baixa</span>
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

function PipelineCard({
  to, icon: Icon, step, title, primary, sub,
}: {
  to: string;
  icon: any;
  step: string;
  title: string;
  primary: string;
  sub: string;
}) {
  return (
    <Link to={to} className="nx-card-hover p-4 flex flex-col gap-2 group">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            {step} · {title}
          </span>
        </div>
        <Icon className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
      </div>
      <div className="text-base font-bold leading-tight">{primary}</div>
      <div className="text-[11px] text-muted-foreground truncate">{sub}</div>
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
      {/* glow sutil colorido por gênero */}
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

/** Traduz nomes técnicos de ações de log pra linguagem humana. */
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
