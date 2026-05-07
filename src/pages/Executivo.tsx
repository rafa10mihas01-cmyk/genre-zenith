import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity, TrendingUp, Gauge, Sparkles, Brain, Handshake,
  AlertTriangle, ArrowRight, ListMusic, Target,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { KpiBig } from "@/components/KpiBig";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";

/* -------------------------------------------------------------- */
/* Tipos                                                          */
/* -------------------------------------------------------------- */
type DatasetRow = {
  id: string;
  followers_now: number | null;
  crescimento_absoluto: number | null;
  tempo_horas: number | null;
};

type Insight = {
  acoes_sugeridas: any[] | null;
  classificacao: { alta?: string[]; baixa?: string[] } | null;
  created_at: string;
};

type ModuleHealth = {
  label: string;
  to: string;
  icon: any;
  status: "ok" | "warn" | "crit" | "idle";
  primary: string;
  secondary: string;
};

/* -------------------------------------------------------------- */
/* Página                                                         */
/* -------------------------------------------------------------- */
export default function Executivo() {
  const [loading, setLoading] = useState(true);
  const [dataset, setDataset] = useState<DatasetRow[]>([]);
  const [insight, setInsight] = useState<Insight | null>(null);

  // Saúde por módulo
  const [genresAtivos, setGenresAtivos] = useState(0);
  const [modelosFresh, setModelosFresh] = useState(0);
  const [modelosTotal, setModelosTotal] = useState(0);
  const [dealsPend, setDealsPend] = useState(0);
  const [dealsTotal, setDealsTotal] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [
        ds, ins, gAtivos, mFresh, mTotal, dPend, dTotal,
      ] = await Promise.all([
        supabase.rpc("get_performance_dataset", { p_min_age_hours: 0 }),
        supabase.from("performance_insights")
          .select("acoes_sugeridas, classificacao, created_at")
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("genres").select("id", { count: "exact", head: true }).eq("status", "ativo"),
        supabase.from("genre_models").select("id", { count: "exact", head: true }).gte("ultima_analise", since),
        supabase.from("genre_models").select("id", { count: "exact", head: true }),
        supabase.from("curator_deals").select("id", { count: "exact", head: true })
          .in("state", ["awaiting_playlists", "awaiting_review", "pending"]),
        supabase.from("curator_deals").select("id", { count: "exact", head: true }),
      ]);
      setDataset((ds.data as unknown as DatasetRow[]) ?? []);
      setInsight((ins.data as unknown as Insight) ?? null);
      setGenresAtivos(gAtivos.count ?? 0);
      setModelosFresh(mFresh.count ?? 0);
      setModelosTotal(mTotal.count ?? 0);
      setDealsPend(dPend.count ?? 0);
      setDealsTotal(dTotal.count ?? 0);
      setLoading(false);
    })();
  }, []);

  /* ---- KPIs north-star ---- */
  const totalPlaylists = dataset.length;
  const totalFollowers = dataset.reduce((s, r) => s + (r.followers_now || 0), 0);
  const totalGrowth = dataset.reduce((s, r) => s + (r.crescimento_absoluto || 0), 0);
  const growing = dataset.filter(r => (r.crescimento_absoluto || 0) > 0).length;
  const successRate = totalPlaylists > 0 ? (growing / totalPlaylists) * 100 : 0;
  const withSpeed = dataset.filter(r => (r.tempo_horas ?? 0) > 0);
  const avgSpeed = withSpeed.length
    ? withSpeed.reduce((s, r) => s + ((r.crescimento_absoluto || 0) / ((r.tempo_horas || 1) / 24)), 0) / withSpeed.length
    : 0;

  /* ---- Saúde por módulo ---- */
  const freshRatio = modelosTotal > 0 ? modelosFresh / modelosTotal : 0;
  const modules: ModuleHealth[] = [
    {
      label: "Cérebro",
      to: "/cerebro",
      icon: Brain,
      status: modelosTotal === 0 ? "idle" : freshRatio >= 0.7 ? "ok" : freshRatio >= 0.4 ? "warn" : "crit",
      primary: `${modelosFresh}/${modelosTotal}`,
      secondary: `modelos atualizados (24h) · ${genresAtivos} gêneros ativos`,
    },
    {
      label: "Performance",
      to: "/performance",
      icon: TrendingUp,
      status: totalPlaylists === 0 ? "idle" : successRate >= 60 ? "ok" : successRate >= 30 ? "warn" : "crit",
      primary: `${successRate.toFixed(0)}%`,
      secondary: `${growing} de ${totalPlaylists} playlists crescendo`,
    },
    {
      label: "Catálogo",
      to: "/catalogo",
      icon: ListMusic,
      status: totalPlaylists === 0 ? "idle" : "ok",
      primary: `${totalPlaylists}`,
      secondary: `playlists publicadas no Spotify`,
    },
    {
      label: "Playlist Deals",
      to: "/playlist-deals",
      icon: Handshake,
      status: dealsPend === 0 ? "ok" : dealsPend > 5 ? "crit" : "warn",
      primary: `${dealsPend}`,
      secondary: `aguardando ação · ${dealsTotal} no total`,
    },
  ];

  /* ---- Top ações da IA ---- */
  const topActions = (insight?.acoes_sugeridas ?? []).slice(0, 3);

  return (
    <PageContainer>
      <PageHeader
        title="Painel executivo"
        subtitle="Resumir saúde da operação em 1 tela"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/">
              Ir para Hoje
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        }
      />

      {/* ZONA 1 — North-star KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBig
          label="Seguidores totais"
          value={totalFollowers.toLocaleString("pt-BR")}
          icon={Activity}
          hint={`${totalPlaylists} playlists ativas`}
          loading={loading}
        />
        <KpiBig
          label="Ganhos no período"
          value={totalGrowth.toLocaleString("pt-BR")}
          icon={TrendingUp}
          tone={totalGrowth > 0 ? "success" : "default"}
          hint="Soma de crescimento"
          loading={loading}
        />
        <KpiBig
          label="Velocidade média"
          value={`${avgSpeed.toFixed(1)}/dia`}
          icon={Gauge}
          tone="primary"
          hint="Seguidores por dia"
          loading={loading}
        />
        <KpiBig
          label="Taxa de sucesso"
          value={`${successRate.toFixed(0)}%`}
          icon={Sparkles}
          tone={successRate >= 60 ? "success" : successRate >= 30 ? "warning" : "destructive"}
          hint="Playlists em crescimento"
          loading={loading}
        />
      </div>

      {/* ZONA 2 — Saúde por módulo */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
            Saúde por módulo
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {insight ? `Última leitura ${timeAgo(insight.created_at)}` : "Sem leitura ainda"}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {modules.map((m) => (
            <ModuleHealthCard key={m.label} m={m} loading={loading} />
          ))}
        </div>
      </section>

      {/* ZONA 3 — Top decisões da IA */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
            Top decisões da semana
          </h2>
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
            <Link to="/performance?tab=acoes">
              Ver todas <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>
        <Card className="p-5">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : topActions.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Nenhuma ação prioritária no momento.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {topActions.map((a: any, i: number) => (
                <li key={i} className="py-3 first:pt-0 last:pb-0 flex items-start gap-3">
                  <Target className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground leading-snug">
                      {a.acao || a.titulo || a.descricao || "Ação sugerida"}
                    </div>
                    {a.justificativa && (
                      <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {a.justificativa}
                      </div>
                    )}
                  </div>
                  {a.prioridade && (
                    <span className={cn(
                      "text-[10px] uppercase font-bold px-2 py-0.5 rounded-full shrink-0",
                      a.prioridade === "alta" && "bg-destructive/15 text-destructive",
                      a.prioridade === "media" && "bg-warning/15 text-warning",
                      a.prioridade === "baixa" && "bg-muted text-muted-foreground",
                    )}>
                      {a.prioridade}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </PageContainer>
  );
}

/* -------------------------------------------------------------- */
/* Card de saúde por módulo                                       */
/* -------------------------------------------------------------- */
const STATUS_DOT: Record<ModuleHealth["status"], string> = {
  ok: "bg-success",
  warn: "bg-warning",
  crit: "bg-destructive",
  idle: "bg-muted-foreground",
};
const STATUS_LABEL: Record<ModuleHealth["status"], string> = {
  ok: "Saudável",
  warn: "Atenção",
  crit: "Crítico",
  idle: "Sem dados",
};
const STATUS_TEXT: Record<ModuleHealth["status"], string> = {
  ok: "text-success",
  warn: "text-warning",
  crit: "text-destructive",
  idle: "text-muted-foreground",
};

function ModuleHealthCard({ m, loading }: { m: ModuleHealth; loading: boolean }) {
  return (
    <Link
      to={m.to}
      className="nx-card p-5 flex flex-col gap-3 hover:bg-card-hover transition-colors group"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <m.icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold text-foreground truncate">{m.label}</span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
      </div>

      {loading ? (
        <Skeleton className="h-7 w-20" />
      ) : (
        <div className="text-2xl font-bold tabular-nums leading-tight">{m.primary}</div>
      )}

      <div className="flex items-center justify-between gap-2 mt-auto">
        <span className="text-[11px] text-muted-foreground truncate flex-1">{m.secondary}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[m.status])} />
          <span className={cn("text-[10px] uppercase tracking-wide font-bold", STATUS_TEXT[m.status])}>
            {STATUS_LABEL[m.status]}
          </span>
        </div>
      </div>
    </Link>
  );
}
