import { Music2, ExternalLink } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Empty, SkeletonGrid } from "@/components/cerebro/_shared";
import { KpiBig } from "@/components/KpiBig";
import { ListMusic, TrendingUp, Users } from "lucide-react";

/**
 * ResumoGenero — bloco que substitui a aba "Visão Geral".
 * Mantém: resumo IA, KPIs avançados, Top 10 playlists, top keywords e padrões.
 * Vai dentro da aba "Dados" como primeira sub-seção.
 */
export function ResumoGenero({ model, loading }: { model: any; loading: boolean }) {
  if (loading) return <SkeletonGrid />;
  if (!model) return <Empty msg="Sem modelo gerado ainda. Clique em Atualizar inteligência." />;

  const insights = model.insights ?? {};
  const ai = insights.ai ?? {};
  const playlistsAll: any[] = model.playlists_dominantes ?? [];
  const playlistsTop = playlistsAll.slice(0, 10);
  const keywords: { value: string; count: number }[] = model.palavras_chave ?? [];
  const padroes: { value: string; count: number }[] = model.padroes_nome ?? [];
  const tracks: any[] = model.musicas_recorrentes ?? [];

  const followers = playlistsAll.map(p => p.seguidores ?? 0).filter(n => n > 0).sort((a, b) => a - b);
  const median = followers.length > 0
    ? followers.length % 2 === 0
      ? Math.round((followers[followers.length / 2 - 1] + followers[followers.length / 2]) / 2)
      : followers[Math.floor(followers.length / 2)]
    : 0;
  const totalReach = followers.reduce((a, b) => a + b, 0);
  const topKws = [...keywords].sort((a, b) => b.count - a.count).slice(0, 6);
  const maxKw = topKws[0]?.count ?? 1;
  const topPadroes = [...padroes].sort((a, b) => b.count - a.count).slice(0, 3);

  return (
    <div className="space-y-5">
      {/* Resumo IA — apenas se existir */}
      {ai.resumo && (
        <div className="nx-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
            Resumo da IA
          </div>
          <p className="text-sm text-foreground/85 leading-relaxed">{ai.resumo}</p>
        </div>
      )}

      {/* KPIs avançados */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiBig icon={ListMusic} label="Playlists analisadas" value={formatNumber(playlistsAll.length || insights.total_playlists_analisadas)} />
        <KpiBig icon={Music2} label="Tracks únicas" value={formatNumber(insights.diversidade_tracks ?? tracks.length)} />
        <KpiBig icon={TrendingUp} label="Mediana seguidores" value={formatNumber(median)} hint="Mais honesto que média" />
        <KpiBig icon={Users} label="Alcance total" value={formatNumber(totalReach)} hint="Soma de seguidores" />
      </div>

      {/* Top 10 + Pulso */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="nx-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">Top 10 playlists do gênero</h3>
            <span className="text-[11px] text-muted-foreground tabular-nums">{playlistsAll.length} totais</span>
          </div>
          {playlistsTop.length === 0 ? <Empty msg="Sem playlists ranqueadas." /> : (
            <div className="space-y-1">
              {playlistsTop.map((p: any, i: number) => (
                <a key={p.url + i} href={p.url} target="_blank" rel="noreferrer"
                   className="flex items-center gap-3 p-2 rounded-lg hover:bg-elevated transition-colors group">
                  <span className={cn("text-sm font-bold w-6 tabular-nums", i < 3 ? "text-primary" : "text-muted-foreground")}>{i + 1}</span>
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

        <div className="space-y-4">
          <div className="nx-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm">Top palavras-chave</h3>
              <span className="text-[10px] text-muted-foreground tabular-nums">{keywords.length} totais</span>
            </div>
            {topKws.length === 0 ? <Empty msg="—" /> : (
              <div className="space-y-2">
                {topKws.map(k => (
                  <div key={k.value} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium truncate">{k.value}</span>
                      <span className="text-muted-foreground tabular-nums shrink-0 ml-2">{k.count}</span>
                    </div>
                    <div className="h-1 rounded-full bg-elevated overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-[width] duration-300" style={{ width: `${(k.count / maxKw) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="nx-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm">Padrões de nome</h3>
              <span className="text-[10px] text-muted-foreground tabular-nums">{padroes.length} totais</span>
            </div>
            {topPadroes.length === 0 ? <Empty msg="—" /> : (
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
