import { Link } from "react-router-dom";
import {
  ListMusic, Music2, TrendingUp, Users, ExternalLink,
  Search, Lightbulb, FileText, Rocket, Wrench, BarChart3, Radio, ArrowRight,
} from "lucide-react";
import { formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { genreStyleVars } from "@/lib/genreColors";
import { KpiBig } from "@/components/KpiBig";
import { Empty, SkeletonGrid, humanizeAttentionReason, type GenreOpt } from "@/pages/Cerebro";

/* ===================== HEADER COMPONENTS (padrão Home) ===================== */

export function GenreStrip({
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
                "shrink-0 px-3.5 py-2 rounded-full border text-xs font-semibold capitalize transition-[background-color,border-color,box-shadow,color] duration-200 flex items-center gap-2",
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

export function GenreHero({ genre, model }: { genre: any; model: any }) {
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

export function HeroStat({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
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

export function QuickActions({ slug }: { slug: string }) {
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
          className="nx-card-hover p-4 flex items-center gap-3 group"
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

export function GenrePipeline({ genre, model }: { genre: any; model: any }) {
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

export function VisaoGeral({ model, loading, genre }: any) {
  if (loading) return <SkeletonGrid />;
  if (!model) return <Empty msg="Sem modelo gerado ainda. Clique em Atualizar inteligência." />;

  const insights = model.insights ?? {};
  const ai = insights.ai ?? {};
  const playlistsAll: any[] = model.playlists_dominantes ?? [];
  const playlistsTop = playlistsAll.slice(0, 10);
  const keywords: { value: string; count: number }[] = model.palavras_chave ?? [];
  const padroes: { value: string; count: number }[] = model.padroes_nome ?? [];
  const tracks: any[] = model.musicas_recorrentes ?? [];

  // KPIs avançados
  const followers = playlistsAll.map(p => p.seguidores ?? 0).filter(n => n > 0).sort((a, b) => a - b);
  const median = followers.length > 0
    ? followers.length % 2 === 0
      ? Math.round((followers[followers.length / 2 - 1] + followers[followers.length / 2]) / 2)
      : followers[Math.floor(followers.length / 2)]
    : 0;
  const totalReach = followers.reduce((a, b) => a + b, 0);

  // Top keywords e padrões pra mini-pulse
  const topKws = [...keywords].sort((a, b) => b.count - a.count).slice(0, 6);
  const maxKw = topKws[0]?.count ?? 1;
  const topPadroes = [...padroes].sort((a, b) => b.count - a.count).slice(0, 3);

  const needsAttention = !!genre?.needs_attention;
  const attentionReason = genre?.attention_reason as string | null;

  return (
    <div className="space-y-5">
      {/* HERO — Estado de saúde do gênero */}
      <div className="nx-card p-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              "inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full",
              needsAttention
                ? "bg-warning/15 text-warning"
                : "bg-primary/15 text-primary",
            )}>
              <span className={cn("h-1.5 w-1.5 rounded-full", needsAttention ? "bg-warning" : "bg-primary")} />
              {needsAttention ? "Requer atenção" : "Saudável"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              Modelo atualizado {timeAgo(model.ultima_analise)}
              {genre?.ultima_coleta && ` • coleta ${timeAgo(genre.ultima_coleta)}`}
            </span>
          </div>
          {needsAttention && attentionReason && (
            <p className="text-xs text-warning/90 leading-relaxed">
              <span className="font-bold">Motivo:</span> {humanizeAttentionReason(attentionReason)}
            </p>
          )}
          {ai.resumo && (
            <p className="text-sm text-foreground/85 leading-relaxed line-clamp-2 max-w-3xl">
              {ai.resumo}
            </p>
          )}
        </div>
      </div>

      {/* KPIs — 4 cards de tamanho de mercado */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiBig
          icon={ListMusic}
          label="Playlists analisadas"
          value={formatNumber(playlistsAll.length || insights.total_playlists_analisadas)}
        />
        <KpiBig
          icon={Music2}
          label="Tracks únicas"
          value={formatNumber(insights.diversidade_tracks ?? tracks.length)}
        />
        <KpiBig
          icon={TrendingUp}
          label="Mediana de seguidores"
          value={formatNumber(median)}
          hint="Mais honesto que média"
        />
        <KpiBig
          icon={Users}
          label="Alcance total"
          value={formatNumber(totalReach)}
          hint="Soma de seguidores"
        />
      </div>

      {/* TOP 10 PLAYLISTS + PULSO DO MODELO */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="nx-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">Top 10 playlists do gênero</h3>
            <span className="text-[11px] text-muted-foreground tabular-nums">{playlistsAll.length} totais</span>
          </div>
          {playlistsTop.length === 0 ? <Empty msg="Sem playlists ranqueadas." />
            : (
              <div className="space-y-1">
                {playlistsTop.map((p: any, i: number) => (
                  <a key={p.url + i} href={p.url} target="_blank" rel="noreferrer"
                     className="flex items-center gap-3 p-2 rounded-lg hover:bg-elevated transition-colors group">
                    <span className={cn(
                      "text-sm font-bold w-6 tabular-nums",
                      i < 3 ? "text-primary" : "text-muted-foreground",
                    )}>{i + 1}</span>
                    {p.imagem ? (
                      <img src={p.imagem} alt="" className="h-12 w-12 rounded object-cover shrink-0" loading="lazy" />
                    ) : (
                      <div className="h-12 w-12 rounded bg-elevated shrink-0 flex items-center justify-center">
                        <Music2 className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.nome}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {formatNumber(p.seguidores)} seguidores
                        {p.total_musicas != null && ` · ${p.total_musicas} faixas`}
                      </div>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                  </a>
                ))}
              </div>
            )}
        </div>

        {/* PULSO DO MODELO */}
        <div className="space-y-4">
          {/* Top keywords */}
          <div className="nx-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm">Top palavras-chave</h3>
              <span className="text-[10px] text-muted-foreground tabular-nums">{keywords.length} totais</span>
            </div>
            {topKws.length === 0 ? <Empty msg="—" />
              : (
                <div className="space-y-2">
                  {topKws.map(k => (
                    <div key={k.value} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium truncate">{k.value}</span>
                        <span className="text-muted-foreground tabular-nums shrink-0 ml-2">{k.count}</span>
                      </div>
                      <div className="h-1 rounded-full bg-elevated overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-[width] duration-300"
                          style={{ width: `${(k.count / maxKw) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>

          {/* Top padrões de nome */}
          <div className="nx-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm">Padrões de nome</h3>
              <span className="text-[10px] text-muted-foreground tabular-nums">{padroes.length} totais</span>
            </div>
            {topPadroes.length === 0 ? <Empty msg="—" />
              : (
                <ul className="space-y-1.5">
                  {topPadroes.map((p, i) => (
                    <li key={p.value} className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-muted-foreground tabular-nums w-4">{i + 1}</span>
                        <span className="font-medium truncate">{p.value}</span>
                      </div>
                      <span className="text-muted-foreground tabular-nums shrink-0">{p.count}×</span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
