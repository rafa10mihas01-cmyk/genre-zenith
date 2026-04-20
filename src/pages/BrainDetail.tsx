import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Sparkles, RefreshCw, ExternalLink, Hash, ListMusic, Loader2 } from "lucide-react";
import { useBrainModel } from "@/hooks/useBrainModel";
import { KpiStrip } from "@/components/brain/KpiStrip";
import { DataTable, Column } from "@/components/brain/DataTable";
import { formatNumber, formatDate, timeAgo } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const NICHO_LABELS: Record<string, string> = { funk: "Funk", sertanejo: "Sertanejo", piseiro: "Piseiro" };

type LogRow = { id: string; created_at: string | null; status: string; mensagem: string | null; duracao_ms: number | null };
type PlaylistRow = { id: string; nome_playlist: string; seguidores: number | null; total_musicas: number | null; spotify_url: string | null; imagem_url: string | null; coletado_em: string | null; posicao: number };
type TrackRow = { id: string; nome_musica: string; artista: string; result_id: string | null };
type TermRow = { id: string; termo: string; tipo: string; total_resultados: number | null; ultima_execucao: string | null; executado: boolean | null };

export default function BrainDetail() {
  const { slug = "" } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { loading, genre, model, reload } = useBrainModel(slug);

  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [terms, setTerms] = useState<TermRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    if (!genre?.id) return;
    let cancelled = false;
    (async () => {
      setLoadingData(true);
      try {
        const [pl, tr, te, lg] = await Promise.all([
          supabase.from("search_results").select("id,nome_playlist,seguidores,total_musicas,spotify_url,imagem_url,coletado_em,posicao").eq("genre_id", genre.id).order("seguidores", { ascending: false }).limit(1000),
          supabase.from("search_tracks").select("id,nome_musica,artista,result_id").eq("genre_id", genre.id).limit(5000),
          supabase.from("search_terms").select("id,termo,tipo,total_resultados,ultima_execucao,executado").eq("genre_id", genre.id).order("total_resultados", { ascending: false }),
          supabase.from("collection_logs").select("id,created_at,status,mensagem,duracao_ms").eq("genre_id", genre.id).eq("acao", "brain-run").order("created_at", { ascending: false }).limit(20),
        ]);
        if (cancelled) return;
        setPlaylists((pl.data ?? []) as PlaylistRow[]);
        setTracks((tr.data ?? []) as TrackRow[]);
        setTerms((te.data ?? []) as TermRow[]);
        setLogs((lg.data ?? []) as LogRow[]);
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => { cancelled = true; };
  }, [genre?.id]);

  const artistAgg = useMemo(() => {
    const map = new Map<string, { artista: string; faixas: number; titulos: Set<string> }>();
    tracks.forEach((t) => {
      const a = (t.artista ?? "").trim();
      if (!a) return;
      const cur = map.get(a) ?? { artista: a, faixas: 0, titulos: new Set() };
      cur.faixas += 1;
      cur.titulos.add(t.nome_musica);
      map.set(a, cur);
    });
    return Array.from(map.values()).map((x) => ({ artista: x.artista, faixas: x.faixas, titulos_unicos: x.titulos.size }));
  }, [tracks]);

  const trackAgg = useMemo(() => {
    const map = new Map<string, { nome_musica: string; artista: string; ocorrencias: number }>();
    tracks.forEach((t) => {
      const k = `${t.nome_musica}|${t.artista}`.toLowerCase();
      const cur = map.get(k) ?? { nome_musica: t.nome_musica, artista: t.artista, ocorrencias: 0 };
      cur.ocorrencias += 1;
      map.set(k, cur);
    });
    return Array.from(map.values());
  }, [tracks]);

  const ai = model?.insights?.ai;

  if (!loading && !genre) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center space-y-4">
        <h1 className="text-2xl font-bold">Nicho não encontrado</h1>
        <Button asChild variant="outline"><Link to="/"><ChevronLeft className="h-4 w-4" /> Voltar</Link></Button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header sticky */}
      <div className="sticky top-12 z-20 -mx-6 px-6 py-4 bg-background/85 backdrop-blur border-b border-border">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <Link to="/"><ChevronLeft className="h-4 w-4" /></Link>
            </Button>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Inteligência</div>
              <h1 className="text-xl font-bold truncate">{genre?.nome ?? NICHO_LABELS[slug] ?? slug}</h1>
            </div>
            {model?.ultima_analise && (
              <Badge variant="outline" className="text-[10px] uppercase">
                Atualizado {timeAgo(model.ultima_analise)}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { reload(); toast.success("Recarregado"); }}>
              <RefreshCw className="h-3.5 w-3.5" /> Recarregar
            </Button>
            <Button size="sm" onClick={() => navigate(`/?run=${slug}`)}>
              <Sparkles className="h-3.5 w-3.5" /> Nova análise
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted-foreground text-sm">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Carregando inteligência...
        </div>
      ) : !model ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center space-y-3">
            <div className="text-sm text-muted-foreground">Nenhuma análise salva para este nicho.</div>
            <Button onClick={() => navigate(`/?run=${slug}`)}>
              <Sparkles className="h-4 w-4" /> Rodar primeira análise
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI strip */}
          <KpiStrip
            items={[
              { label: "Playlists", value: formatNumber(playlists.length || genre?.total_playlists) },
              { label: "Faixas únicas", value: formatNumber(trackAgg.length) },
              { label: "Faixas totais", value: formatNumber(tracks.length || genre?.total_musicas) },
              { label: "Artistas", value: formatNumber(artistAgg.length) },
              { label: "Termos", value: formatNumber(terms.length || genre?.total_termos) },
              { label: "Análises", value: formatNumber(logs.length), hint: model.ultima_analise ? formatDate(model.ultima_analise) : undefined },
            ]}
          />

          {/* Tabs */}
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6 h-auto">
              <TabsTrigger value="overview">Visão geral</TabsTrigger>
              <TabsTrigger value="playlists">Playlists</TabsTrigger>
              <TabsTrigger value="tracks">Faixas</TabsTrigger>
              <TabsTrigger value="artists">Artistas</TabsTrigger>
              <TabsTrigger value="terms">Termos</TabsTrigger>
              <TabsTrigger value="history">Histórico</TabsTrigger>
            </TabsList>

            {/* OVERVIEW */}
            <TabsContent value="overview" className="space-y-4">
              {ai?.resumo && (
                <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-transparent">
                  <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Resumo executivo</CardTitle></CardHeader>
                  <CardContent className="text-sm leading-relaxed">{ai.resumo}</CardContent>
                </Card>
              )}

              <div className="grid md:grid-cols-2 gap-4">
                {Array.isArray(ai?.tendencias) && ai.tendencias.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle className="text-sm">Tendências</CardTitle></CardHeader>
                    <CardContent>
                      <ul className="space-y-2 text-sm">
                        {ai.tendencias.map((t: string, i: number) => (
                          <li key={i} className="flex gap-2"><span className="text-primary">▸</span><span>{t}</span></li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
                {Array.isArray(ai?.oportunidades_seo) && ai.oportunidades_seo.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle className="text-sm">Oportunidades SEO</CardTitle></CardHeader>
                    <CardContent>
                      <ul className="space-y-2 text-sm">
                        {ai.oportunidades_seo.map((t: string, i: number) => (
                          <li key={i} className="flex gap-2"><span className="text-[hsl(var(--success))]">✦</span><span>{t}</span></li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Hash className="h-4 w-4" /> Palavras-chave</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1.5">
                      {(model.palavras_chave ?? []).slice(0, 30).map((p) => (
                        <Badge key={p.value} variant="secondary" className="text-xs">
                          {p.value} <span className="ml-1 opacity-60">{p.count}</span>
                        </Badge>
                      ))}
                      {(!model.palavras_chave || model.palavras_chave.length === 0) && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-sm flex items-center gap-2"><ListMusic className="h-4 w-4" /> Padrões de nome</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1.5">
                      {(model.padroes_nome ?? []).slice(0, 20).map((p) => (
                        <Badge key={p.value} variant="outline" className="text-xs">
                          "{p.value}" <span className="ml-1 opacity-60">{p.count}</span>
                        </Badge>
                      ))}
                      {(!model.padroes_nome || model.padroes_nome.length === 0) && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {Array.isArray(ai?.sugestoes_nomes) && ai.sugestoes_nomes.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">Sugestões de nomes para nova playlist</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {ai.sugestoes_nomes.map((s: string, i: number) => (
                        <Badge key={i} variant="outline" className="border-primary/40">{s}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* PLAYLISTS */}
            <TabsContent value="playlists">
              <DataTable<PlaylistRow>
                rows={playlists}
                exportFilename={`playlists-${slug}`}
                searchKeys={["nome_playlist"]}
                searchPlaceholder="Buscar playlist..."
                initialSort={{ key: "seguidores", dir: "desc" }}
                emptyLabel={loadingData ? "Carregando..." : "Nenhuma playlist coletada."}
                columns={[
                  {
                    key: "nome_playlist", header: "Playlist", accessor: (r) => r.nome_playlist, sortable: true,
                    cell: (r) => (
                      <div className="flex items-center gap-2 min-w-0">
                        {r.imagem_url ? <img src={r.imagem_url} alt="" className="h-8 w-8 rounded object-cover shrink-0" /> : <div className="h-8 w-8 rounded bg-muted shrink-0" />}
                        <span className="truncate font-medium">{r.nome_playlist}</span>
                      </div>
                    ),
                  },
                  { key: "seguidores", header: "Seguidores", accessor: (r) => r.seguidores ?? 0, sortable: true, align: "right", cell: (r) => formatNumber(r.seguidores) },
                  { key: "total_musicas", header: "Faixas", accessor: (r) => r.total_musicas ?? 0, sortable: true, align: "right" },
                  { key: "posicao", header: "Pos.", accessor: (r) => r.posicao, sortable: true, align: "right" },
                  { key: "coletado_em", header: "Coletado", accessor: (r) => r.coletado_em, sortable: true, cell: (r) => <span className="text-xs text-muted-foreground">{timeAgo(r.coletado_em)}</span> },
                  {
                    key: "url", header: "", accessor: (r) => r.spotify_url, align: "center",
                    cell: (r) => r.spotify_url ? (
                      <a href={r.spotify_url} target="_blank" rel="noreferrer" className="text-primary hover:opacity-80 inline-flex"><ExternalLink className="h-3.5 w-3.5" /></a>
                    ) : null,
                  },
                ]}
              />
            </TabsContent>

            {/* TRACKS */}
            <TabsContent value="tracks">
              <DataTable
                rows={trackAgg}
                exportFilename={`faixas-${slug}`}
                searchKeys={["nome_musica", "artista"]}
                searchPlaceholder="Buscar faixa ou artista..."
                initialSort={{ key: "ocorrencias", dir: "desc" }}
                emptyLabel={loadingData ? "Carregando..." : "Nenhuma faixa coletada."}
                columns={[
                  { key: "nome_musica", header: "Música", accessor: (r) => r.nome_musica, sortable: true, cell: (r) => <span className="font-medium truncate block">{r.nome_musica}</span> },
                  { key: "artista", header: "Artista", accessor: (r) => r.artista, sortable: true, cell: (r) => <span className="text-muted-foreground truncate block">{r.artista}</span> },
                  { key: "ocorrencias", header: "Ocorrências", accessor: (r) => r.ocorrencias, sortable: true, align: "right" },
                ]}
              />
            </TabsContent>

            {/* ARTISTS */}
            <TabsContent value="artists">
              <DataTable
                rows={artistAgg}
                exportFilename={`artistas-${slug}`}
                searchKeys={["artista"]}
                searchPlaceholder="Buscar artista..."
                initialSort={{ key: "faixas", dir: "desc" }}
                emptyLabel={loadingData ? "Carregando..." : "Nenhum artista coletado."}
                columns={[
                  { key: "artista", header: "Artista", accessor: (r) => r.artista, sortable: true, cell: (r) => <span className="font-medium">{r.artista}</span> },
                  { key: "faixas", header: "Faixas em playlists", accessor: (r) => r.faixas, sortable: true, align: "right" },
                  { key: "titulos_unicos", header: "Títulos únicos", accessor: (r) => r.titulos_unicos, sortable: true, align: "right" },
                ]}
              />
            </TabsContent>

            {/* TERMS */}
            <TabsContent value="terms">
              <DataTable<TermRow>
                rows={terms}
                exportFilename={`termos-${slug}`}
                searchKeys={["termo"]}
                searchPlaceholder="Buscar termo..."
                initialSort={{ key: "total_resultados", dir: "desc" }}
                emptyLabel={loadingData ? "Carregando..." : "Nenhum termo cadastrado."}
                columns={[
                  { key: "termo", header: "Termo", accessor: (r) => r.termo, sortable: true, cell: (r) => <span className="font-medium">{r.termo}</span> },
                  { key: "tipo", header: "Tipo", accessor: (r) => r.tipo, sortable: true, cell: (r) => <Badge variant="outline" className="text-[10px] uppercase">{r.tipo}</Badge> },
                  { key: "total_resultados", header: "Resultados", accessor: (r) => r.total_resultados ?? 0, sortable: true, align: "right" },
                  { key: "executado", header: "Status", accessor: (r) => (r.executado ? 1 : 0), sortable: true, cell: (r) => (
                    <span className={cn("inline-flex items-center gap-1.5 text-xs", r.executado ? "text-[hsl(var(--success))]" : "text-muted-foreground")}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", r.executado ? "bg-[hsl(var(--success))]" : "bg-muted-foreground/40")} />
                      {r.executado ? "executado" : "pendente"}
                    </span>
                  ) },
                  { key: "ultima_execucao", header: "Última", accessor: (r) => r.ultima_execucao, sortable: true, cell: (r) => <span className="text-xs text-muted-foreground">{timeAgo(r.ultima_execucao)}</span> },
                ]}
              />
            </TabsContent>

            {/* HISTORY */}
            <TabsContent value="history">
              <DataTable<LogRow>
                rows={logs}
                exportFilename={`historico-${slug}`}
                searchKeys={["mensagem", "status"]}
                searchPlaceholder="Buscar no histórico..."
                initialSort={{ key: "created_at", dir: "desc" }}
                emptyLabel={loadingData ? "Carregando..." : "Nenhuma execução registrada."}
                columns={[
                  { key: "created_at", header: "Quando", accessor: (r) => r.created_at, sortable: true, cell: (r) => (
                    <div className="flex flex-col">
                      <span className="text-sm">{formatDate(r.created_at)}</span>
                      <span className="text-[10px] text-muted-foreground">{timeAgo(r.created_at)}</span>
                    </div>
                  ) },
                  { key: "status", header: "Status", accessor: (r) => r.status, sortable: true, cell: (r) => (
                    <Badge variant={r.status === "sucesso" ? "default" : r.status === "erro" ? "destructive" : "secondary"} className="text-[10px] uppercase">
                      {r.status}
                    </Badge>
                  ) },
                  { key: "duracao_ms", header: "Duração", accessor: (r) => r.duracao_ms ?? 0, sortable: true, align: "right", cell: (r) => r.duracao_ms ? `${Math.round(r.duracao_ms / 1000)}s` : "—" },
                  { key: "mensagem", header: "Mensagem", accessor: (r) => r.mensagem, cell: (r) => <span className="text-xs text-muted-foreground truncate block max-w-md">{r.mensagem}</span> },
                ]}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
