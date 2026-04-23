import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { KpiBig } from "@/components/KpiBig";
import { Brain, ListMusic, Music2, TrendingUp, ArrowRight, Activity, Sparkles } from "lucide-react";
import { formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { genreStyleVars } from "@/lib/genreColors";
import { PageHeader } from "@/components/PageHeader";

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
      <PageHeader
        title="Visão geral"
        subtitle="Acompanhar o estado do sistema e abrir a inteligência completa de cada gênero no Cérebro."
      />

      {/* KPIs globais */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiBig icon={ListMusic} label="Gêneros analisados" value={stats ? `${stats.analyzed}/${stats.totalGenres}` : "—"} hint="Cobertura do sistema" loading={loading} />
        <KpiBig icon={Music2} label="Playlists coletadas" value={formatNumber(stats?.playlists)} hint="Base monitorada" loading={loading} />
        <KpiBig icon={TrendingUp} label="Faixas mapeadas" value={formatNumber(stats?.tracks)} hint="Universo identificado" loading={loading} />
        <KpiBig
          icon={Activity}
          label="Última atividade"
          value={activity[0]?.created_at ? timeAgo(activity[0].created_at) : "—"}
          hint="Evento mais recente"
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
      style={genreStyleVars(g.slug || g.nome)}
      className="genre-card nx-card-hover p-5 group flex flex-col gap-4 relative overflow-hidden"
    >
      {/* Glow de fundo na cor do gênero (sutil) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background:
            "radial-gradient(circle at 0% 0%, hsl(var(--g) / 0.18) 0%, transparent 55%)",
        }}
      />

      {/* Avatar circular grande estilo Spotify, tingido pela cor do gênero */}
      <div className="relative flex items-start justify-between">
        <div
          className="h-14 w-14 rounded-full flex items-center justify-center text-xl font-bold shrink-0 transition-all"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--g) / 0.35), hsl(var(--g) / 0.10))",
            border: "1px solid hsl(var(--g) / 0.45)",
            color: "hsl(var(--g))",
            boxShadow: "0 0 20px -8px hsl(var(--g) / 0.5)",
          }}
        >
          {g.nome.slice(0, 2).toUpperCase()}
        </div>
        <span className={cn("text-[10px] uppercase tracking-wider font-bold", statusColor)}>
          ● {statusLabel}
        </span>
      </div>

      <div className="relative space-y-1">
        <h3 className="text-lg font-bold capitalize leading-tight">{g.nome}</h3>
        <p className="text-[11px] text-muted-foreground">
          {g.ultima_analise
            ? `Última análise ${timeAgo(g.ultima_analise)}`
            : g.ultima_coleta
            ? `Coletado ${timeAgo(g.ultima_coleta)}`
            : "Sem coleta"}
        </p>
      </div>

      <div className="relative flex items-center gap-4 pt-1 mt-auto">
        <Metric label="Playlists" value={formatNumber(g.total_playlists)} />
        <Metric label="Faixas" value={formatNumber(g.total_musicas)} />
      </div>

      {/* Botão hover na cor do gênero */}
      <div
        className="absolute bottom-4 right-4 h-10 w-10 rounded-full flex items-center justify-center opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all"
        style={{
          background: "hsl(var(--g))",
          color: "#000",
          boxShadow: "0 8px 24px -6px hsl(var(--g) / 0.6)",
        }}
      >
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
