import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Brain, ExternalLink, RefreshCw, Sparkles, TrendingUp, Music, Hash, ListMusic } from "lucide-react";
import { toast } from "sonner";
import { formatNumber, timeAgo } from "@/lib/format";

interface KW { value: string; count: number }
interface Playlist { nome: string; seguidores: number; url: string; imagem?: string; total_musicas?: number }
interface Track { nome: string; artista: string; count: number }
interface Insights {
  total_playlists_analisadas: number;
  total_tracks_analisadas: number;
  media_seguidores: number;
  diversidade_tracks: number;
  maior_playlist: Playlist | null;
}

export default function ModelDetail() {
  const { genreId } = useParams<{ genreId: string }>();
  const [genre, setGenre] = useState<{ nome: string; total_playlists: number | null } | null>(null);
  const [model, setModel] = useState<{
    palavras_chave: KW[];
    padroes_nome: KW[];
    playlists_dominantes: Playlist[];
    musicas_recorrentes: Track[];
    insights: Insights;
    ultima_analise: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(false);

  async function load() {
    if (!genreId) return;
    setLoading(true);
    const [{ data: g }, { data: m }] = await Promise.all([
      supabase.from("genres").select("nome,total_playlists").eq("id", genreId).single(),
      supabase.from("genre_models").select("*").eq("genre_id", genreId).maybeSingle(),
    ]);
    setGenre(g);
    if (m) {
      setModel({
        palavras_chave: (m.palavras_chave as any) ?? [],
        padroes_nome: (m.padroes_nome as any) ?? [],
        playlists_dominantes: (m.playlists_dominantes as any) ?? [],
        musicas_recorrentes: (m.musicas_recorrentes as any) ?? [],
        insights: (m.insights as any) ?? {},
        ultima_analise: m.ultima_analise,
      });
    } else {
      setModel(null);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [genreId]);

  async function reanalyze() {
    if (!genreId) return;
    setReanalyzing(true);
    const { data, error } = await supabase.functions.invoke("analyze-genre", { body: { genre_id: genreId } });
    setReanalyzing(false);
    if (error || !data?.ok) {
      toast.error("Falha ao re-analisar");
      return;
    }
    toast.success("Modelo atualizado");
    load();
  }

  async function generateAI() {
    if (!genreId) return;
    setGeneratingAI(true);
    const { data, error } = await supabase.functions.invoke("genre-insights", { body: { genre_id: genreId } });
    setGeneratingAI(false);
    if (error || !data?.ok) {
      toast.error("Falha ao gerar insights IA", { description: error?.message ?? data?.error });
      return;
    }
    toast.success("Insights gerados pela IA");
    load();
  }

  const maxKW = Math.max(...(model?.palavras_chave ?? []).map(k => k.count), 1);
  const maxPad = Math.max(...(model?.padroes_nome ?? []).map(k => k.count), 1);

  return (
    <div className="max-w-[1400px] mx-auto">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
        <Link to="/models"><ArrowLeft className="h-4 w-4" /> Voltar</Link>
      </Button>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center">
            <Brain className="h-6 w-6 text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{genre?.nome ?? "—"}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {model ? `Modelo gerado ${timeAgo(model.ultima_analise)}` : "Sem modelo ainda"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={reanalyze} disabled={reanalyzing}>
            <RefreshCw className={`h-4 w-4 ${reanalyzing ? "animate-spin" : ""}`} />
            Re-analisar
          </Button>
          <Button size="sm" onClick={generateAI} disabled={generatingAI || !model}>
            {generatingAI ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {model?.insights?.ai ? "Re-gerar com IA" : "Gerar com IA"}
          </Button>
        </div>
      </div>

      {loading && <div className="nx-card p-12 mt-6 text-center text-sm text-muted-foreground">Carregando…</div>}

      {!loading && !model && (
        <div className="nx-card p-12 mt-6 text-center">
          <Sparkles className="h-8 w-8 mx-auto text-muted-foreground" />
          <h2 className="mt-3 font-semibold">Modelo não gerado</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {(genre?.total_playlists ?? 0) > 0
              ? "Clique em Re-analisar para gerar agora."
              : "Colete dados antes de gerar o modelo."}
          </p>
        </div>
      )}

      {!loading && model && (
        <>
          {/* Insights cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
            <InsightCard icon={ListMusic} label="Playlists analisadas" value={formatNumber(model.insights.total_playlists_analisadas)} />
            <InsightCard icon={Music} label="Tracks analisadas" value={formatNumber(model.insights.total_tracks_analisadas)} />
            <InsightCard icon={TrendingUp} label="Média de seguidores" value={formatNumber(model.insights.media_seguidores)} />
            <InsightCard icon={Hash} label="Tracks únicas" value={formatNumber(model.insights.diversidade_tracks)} />
          </div>

          <Tabs defaultValue={model.insights?.ai ? "ai" : "keywords"} className="mt-6">
            <TabsList>
              <TabsTrigger value="ai" className="gap-1.5">
                <Wand2 className="h-3.5 w-3.5" /> Insights IA
              </TabsTrigger>
              <TabsTrigger value="keywords">Palavras-chave</TabsTrigger>
              <TabsTrigger value="patterns">Padrões de nome</TabsTrigger>
              <TabsTrigger value="playlists">Playlists dominantes</TabsTrigger>
              <TabsTrigger value="tracks">Músicas recorrentes</TabsTrigger>
            </TabsList>

            <TabsContent value="ai">
              <AIInsightsPanel ai={model.insights?.ai} loading={generatingAI} onGenerate={generateAI} />
            </TabsContent>

            <TabsContent value="keywords">
              <div className="nx-card p-5">
                <h3 className="font-semibold mb-1">Top 30 palavras-chave</h3>
                <p className="text-xs text-muted-foreground mb-4">Termos mais frequentes nos títulos das playlists deste gênero.</p>
                {model.palavras_chave.length === 0 && <EmptyState />}
                <div className="space-y-1.5">
                  {model.palavras_chave.map(k => (
                    <BarRow key={k.value} label={k.value} count={k.count} max={maxKW} />
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="patterns">
              <div className="nx-card p-5">
                <h3 className="font-semibold mb-1">Padrões de nomenclatura (bigramas)</h3>
                <p className="text-xs text-muted-foreground mb-4">Combinações de 2 palavras mais usadas em títulos.</p>
                {model.padroes_nome.length === 0 && <EmptyState />}
                <div className="space-y-1.5">
                  {model.padroes_nome.map(k => (
                    <BarRow key={k.value} label={k.value} count={k.count} max={maxPad} />
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="playlists">
              <div className="nx-card p-5">
                <h3 className="font-semibold mb-1">Top 25 playlists por seguidores</h3>
                <p className="text-xs text-muted-foreground mb-4">As playlists com maior alcance neste gênero.</p>
                {model.playlists_dominantes.length === 0 && <EmptyState />}
                <div className="grid sm:grid-cols-2 gap-2">
                  {model.playlists_dominantes.map((p, i) => (
                    <a key={p.url + i} href={p.url} target="_blank" rel="noreferrer"
                       className="flex items-center gap-3 p-2.5 rounded-lg border border-border hover:border-accent/50 hover:bg-muted/30 transition-colors group">
                      {p.imagem
                        ? <img src={p.imagem} alt="" className="h-12 w-12 rounded object-cover shrink-0" loading="lazy" />
                        : <div className="h-12 w-12 rounded bg-muted shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{p.nome}</div>
                        <div className="text-xs text-muted-foreground">{formatNumber(p.seguidores)} seguidores</div>
                      </div>
                      <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="tracks">
              <div className="nx-card p-5">
                <h3 className="font-semibold mb-1">Músicas mais recorrentes</h3>
                <p className="text-xs text-muted-foreground mb-4">Faixas que aparecem em múltiplas playlists deste gênero.</p>
                {model.musicas_recorrentes.length === 0 && <EmptyState />}
                <div className="divide-y divide-border">
                  {model.musicas_recorrentes.map((t, i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5">
                      <div className="text-xs text-muted-foreground w-6 tabular-nums">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{t.nome}</div>
                        <div className="text-xs text-muted-foreground truncate">{t.artista}</div>
                      </div>
                      <div className="text-xs font-mono text-accent">×{t.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function InsightCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="nx-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-2xl font-bold mt-1.5 tabular-nums">{value}</div>
    </div>
  );
}

function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = (count / max) * 100;
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 sm:w-40 text-sm truncate" title={label}>{label}</div>
      <div className="flex-1 h-6 bg-muted/40 rounded relative overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-accent/60 rounded" style={{ width: `${pct}%` }} />
      </div>
      <div className="w-10 text-right text-xs font-mono text-muted-foreground tabular-nums">{count}</div>
    </div>
  );
}

function EmptyState() {
  return <p className="text-sm text-muted-foreground py-6 text-center">Nada por aqui ainda.</p>;
}
