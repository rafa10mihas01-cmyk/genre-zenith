import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Brain, Sparkles, ListMusic, Music2, TrendingUp, ArrowRight, Activity, Loader2 } from "lucide-react";
import { formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { genreStyleVars } from "@/lib/genreColors";

/**
 * HOME — Resumo executivo do sistema.
 * Mostra agregados globais + lista todos os gêneros (cards). Clicar abre /cerebro/:slug.
 * 100% dados reais do banco. Sem dado → "—" ou skeleton.
 */

type GenreCard = {
  id: string;
  slug: string;
  nome: string;
  status: string | null;
  total_playlists: number | null;
  total_musicas: number | null;
  ultima_coleta: string | null;
  has_model: boolean;
  ultima_analise: string | null;
};

type Stats = {
  totalGenres: number;
  analyzed: number;
  playlists: number;
  tracks: number;
};

type ActivityRow = {
  id: string;
  acao: string;
  status: string;
  mensagem: string | null;
  created_at: string;
};

export default function Home() {
  const [genres, setGenres] = useState<GenreCard[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [
      { data: gs },
      { data: models },
      { count: totalGenres },
      { count: analyzed },
      { count: playlists },
      { count: tracks },
      { data: logs },
    ] = await Promise.all([
      supabase
        .from("genres")
        .select("id,slug,nome,status,total_playlists,total_musicas,ultima_coleta")
        .order("total_playlists", { ascending: false, nullsFirst: false }),
      supabase.from("genre_models").select("genre_id,ultima_analise"),
      supabase.from("genres").select("*", { count: "exact", head: true }),
      supabase.from("genres").select("*", { count: "exact", head: true }).eq("status", "analisado"),
      supabase.from("search_results").select("*", { count: "exact", head: true }),
      supabase.from("search_tracks").select("*", { count: "exact", head: true }),
      supabase
        .from("collection_logs")
        .select("id,acao,status,mensagem,created_at")
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

    const modelMap = new Map((models ?? []).map(m => [m.genre_id, m.ultima_analise]));
    setGenres(
      (gs ?? []).map(g => ({
        ...g,
        has_model: modelMap.has(g.id),
        ultima_analise: modelMap.get(g.id) ?? null,
      })) as GenreCard[],
    );
    setStats({
      totalGenres: totalGenres ?? 0,
      analyzed: analyzed ?? 0,
      playlists: playlists ?? 0,
      tracks: tracks ?? 0,
    });
    setActivity((logs ?? []) as ActivityRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto">
      {/* Saudação */}
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Bom dia 👋</h1>
        <p className="text-sm text-muted-foreground">
          Visão geral do sistema. Selecione um gênero para abrir a inteligência completa no Cérebro.
        </p>
      </header>

      {/* KPIs globais */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={ListMusic} label="Gêneros analisados" value={stats ? `${stats.analyzed}/${stats.totalGenres}` : "—"} loading={loading} />
        <KpiCard icon={Music2} label="Playlists coletadas" value={formatNumber(stats?.playlists)} loading={loading} />
        <KpiCard icon={TrendingUp} label="Faixas mapeadas" value={formatNumber(stats?.tracks)} loading={loading} />
        <KpiCard
          icon={Activity}
          label="Última atividade"
          valueRaw={activity[0]?.created_at ? timeAgo(activity[0].created_at) : "—"}
          loading={loading}
        />
      </section>

      {/* Gêneros */}
      <section className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Seus gêneros</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {loading ? "Carregando..." : `${genres.length} cadastrados • clique para abrir o Cérebro`}
            </p>
          </div>
          <Button asChild variant="ghost" size="sm" className="rounded-full text-muted-foreground hover:text-foreground gap-1">
            <Link to="/cerebro">Ver tudo <ArrowRight className="h-3.5 w-3.5" /></Link>
          </Button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="nx-card p-5 h-44 animate-pulse" />
            ))}
          </div>
        ) : genres.length === 0 ? (
          <div className="nx-card p-12 text-center">
            <Brain className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">Nenhum gênero cadastrado ainda.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {genres.map(g => <GenreCardItem key={g.id} g={g} />)}
          </div>
        )}
      </section>

      {/* Atividade recente */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold tracking-tight">Atividade recente</h2>
        <div className="nx-card p-2 divide-y divide-border">
          {loading && activity.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">Carregando…</div>
          )}
          {!loading && activity.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">Sem atividade registrada.</div>
          )}
          {activity.map(l => (
            <div key={l.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={cn(
                  "h-2 w-2 rounded-full shrink-0",
                  l.status === "sucesso" ? "bg-primary"
                  : l.status === "erro" ? "bg-destructive"
                  : "bg-warning",
                )} />
                <span className="font-medium text-xs">{l.acao}</span>
                {l.mensagem && (
                  <span className="text-muted-foreground text-xs truncate hidden md:inline">— {l.mensagem}</span>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground shrink-0">{timeAgo(l.created_at)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, valueRaw, loading,
}: { icon: any; label: string; value?: string; valueRaw?: string; loading?: boolean }) {
  return (
    <div className="nx-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-medium">{label}</span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="text-2xl font-bold mt-2 tabular-nums">
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (valueRaw ?? value ?? "—")}
      </div>
    </div>
  );
}

function GenreCardItem({ g }: { g: GenreCard }) {
  const status = (g.status ?? "pendente").toLowerCase();
  const statusLabel =
    status === "analisado" ? "Completo"
    : status === "coletando" ? "Coletando"
    : status === "erro" ? "Com erro"
    : (g.total_playlists ?? 0) > 0 ? "Parcial"
    : "Pendente";
  const statusColor =
    status === "analisado" ? "text-primary"
    : status === "erro" ? "text-destructive"
    : status === "coletando" ? "text-warning"
    : "text-muted-foreground";

  return (
    <Link
      to={`/cerebro/${g.slug}`}
      className="nx-card-hover p-5 group flex flex-col gap-4 relative overflow-hidden"
    >
      {/* Avatar circular grande estilo Spotify */}
      <div className="flex items-start justify-between">
        <div className="h-14 w-14 rounded-full bg-elevated border border-border flex items-center justify-center text-xl font-bold text-foreground/80 shrink-0 group-hover:border-primary/40 transition-colors">
          {g.nome.slice(0, 2).toUpperCase()}
        </div>
        <span className={cn("text-[10px] uppercase tracking-wider font-bold", statusColor)}>
          ● {statusLabel}
        </span>
      </div>

      <div className="space-y-1">
        <h3 className="text-lg font-bold capitalize leading-tight">{g.nome}</h3>
        <p className="text-[11px] text-muted-foreground">
          {g.ultima_analise
            ? `Última análise ${timeAgo(g.ultima_analise)}`
            : g.ultima_coleta
            ? `Coletado ${timeAgo(g.ultima_coleta)}`
            : "Sem coleta"}
        </p>
      </div>

      <div className="flex items-center gap-4 pt-1 mt-auto">
        <Metric label="Playlists" value={formatNumber(g.total_playlists)} />
        <Metric label="Faixas" value={formatNumber(g.total_musicas)} />
      </div>

      {/* Hover: aparece botão circular verde estilo Spotify */}
      <div className="absolute bottom-4 right-4 h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all shadow-lg shadow-primary/30">
        <Sparkles className="h-4 w-4" />
      </div>
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}
