import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Brain, Lock, Unlock, Trash2, RotateCcw, Play, ExternalLink, AlertTriangle, Sparkles, History, TrendingUp } from "lucide-react";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { formatNumber, timeAgo } from "@/lib/format";

type GenreItem = {
  id: string; slug: string; nome: string; ativo: boolean;
  winners_count: number; last_learned_at: string | null;
};

type Kw = {
  value: string; count: number; source: string; locked: boolean;
  coverage: number; contributors: any[]; drift_signals: string[];
};
type Art = { artista: string; count: number; source: string; locked: boolean };
type Trk = { nome_musica: string; artista: string; ocorrencias: number; spotify_track_id: string | null; source: string };

type AuditResp = {
  ok: boolean;
  genres: GenreItem[];
  genre?: { id: string; slug: string; nome: string };
  ultima_analise?: string | null;
  learning_meta?: any;
  keywords?: Kw[];
  artists?: Art[];
  tracks?: Trk[];
  diff?: { last_run_at: string; added_keywords: string[]; removed_keywords: string[]; emerging_tracks: number } | null;
  history?: { id: string; created_at: string; winners: number; keywords_added: number; updated: boolean; reason: string | null }[];
  drift?: { ratio: number; alert: "alto" | "médio" | "baixo"; count: number; total: number };
  top_winners?: { id: string; nome: string; winner_score: number; seguidores: number; url: string; owner: string }[];
  total_winners?: number;
};

export default function AdminAprendizado({ embedded = false }: { embedded?: boolean } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const genreId = searchParams.get("g");
  const [data, setData] = useState<AuditResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const qs = genreId ? `?genre_id=${genreId}` : "";
    const { data: r, error } = await supabase.functions.invoke("learning-audit", { method: "GET" as any, body: undefined, headers: {} });
    // supabase.functions.invoke doesn't accept GET cleanly; usar fetch direto
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const base = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.functions.supabase.co/learning-audit`;
        const { data: { session } } = await supabase.auth.getSession();
        const url = genreId ? `${base}?genre_id=${genreId}` : base;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } });
        const j = await r.json();
        if (!cancelled) setData(j);
      } catch (e) {
        toast({ title: "Erro ao carregar auditoria", description: String((e as Error).message), variant: "destructive" });
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [genreId]);

  async function callGov(action: string, value?: string) {
    if (!genreId) return;
    setBusy(`${action}:${value ?? ""}`);
    try {
      const { error } = await supabase.functions.invoke("learning-governance", {
        body: { genre_id: genreId, action, value },
      });
      if (error) throw error;
      toast({ title: "Aplicado", description: `${action}${value ? ` · ${value}` : ""}` });
      // reload
      const base = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.functions.supabase.co/learning-audit`;
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${base}?genre_id=${genreId}`, { headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } });
      setData(await r.json());
    } catch (e) {
      toast({ title: "Falhou", description: String((e as Error).message), variant: "destructive" });
    } finally { setBusy(null); }
  }

  async function learnNow() {
    if (!genreId) return;
    setBusy("learn-now");
    try {
      const { error } = await supabase.functions.invoke("learn-from-winners", { body: { genre_id: genreId, min_winner: 60 } });
      if (error) throw error;
      toast({ title: "Aprendizado executado" });
      // reload
      const base = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.functions.supabase.co/learning-audit`;
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${base}?genre_id=${genreId}`, { headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } });
      setData(await r.json());
    } catch (e) {
      toast({ title: "Falhou", description: String((e as Error).message), variant: "destructive" });
    } finally { setBusy(null); }
  }

  const genres = data?.genres ?? [];
  const selected = data?.genre;

  const Wrapper: any = embedded ? "div" : PageContainer;

  return (
    <Wrapper {...(embedded ? {} : {})}>
      {!embedded && (
        <PageHeader
        domain="system" title="Governança do Aprendizado" subtitle="Governança da IA" icon={<Brain className="h-5 w-5" />} />
      )}

      <div className={cn("grid grid-cols-12 gap-6", !embedded && "mt-6")}>
        {/* SIDEBAR GÊNEROS */}
        <aside className="col-span-12 lg:col-span-3">
          <div className="nx-card p-3 sticky top-4 max-h-[80vh] overflow-y-auto">
            <p className="text-xs uppercase tracking-wide text-muted-foreground px-2 mb-2">Gêneros</p>
            {loading && !genres.length && Array.from({ length: 6 }).map((_, i) => (<Skeleton key={i} className="h-9 my-1" />))}
            <ul className="space-y-1">
              {genres.map(g => {
                const active = g.id === genreId;
                return (
                  <li key={g.id}>
                    <button
                      onClick={() => setSearchParams({ g: g.id })}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-md hover:bg-elevated transition-colors",
                        active && "bg-elevated border border-border",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{g.nome}</span>
                        <Badge variant="outline" className="text-[10px]">{g.winners_count}</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {g.last_learned_at ? `apreendido ${timeAgo(g.last_learned_at)}` : "nunca aprendido"}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        {/* DETALHE */}
        <div className="col-span-12 lg:col-span-9 space-y-6">
          {!genreId && !loading && (
            <div className="nx-card p-10 text-center text-muted-foreground">
              Selecione um gênero à esquerda para ver o que a IA aprendeu.
            </div>
          )}

          {genreId && (
            <>
              {/* HEADER GÊNERO + AÇÕES */}
              <div className="nx-card p-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    {selected?.nome ?? "—"}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {data?.total_winners ?? 0} winners · última análise {data?.ultima_analise ? timeAgo(data.ultima_analise) : "—"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => callGov("revert_last")} disabled={busy !== null}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reverter última
                  </Button>
                  <Button size="sm" onClick={learnNow} disabled={busy !== null}>
                    <Play className="h-3.5 w-3.5 mr-1.5" /> Aprender agora
                  </Button>
                </div>
              </div>

              {/* DRIFT + DIFF */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="nx-card p-4">
                  <p className="text-xs uppercase text-muted-foreground mb-1">Drift</p>
                  <div className="flex items-center gap-2">
                    {data?.drift?.alert === "alto" && <AlertTriangle className="h-4 w-4 text-destructive" />}
                    <span className={cn("text-2xl font-semibold capitalize",
                      data?.drift?.alert === "alto" && "text-destructive",
                      data?.drift?.alert === "médio" && "text-warning",
                    )}>{data?.drift?.alert ?? "—"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{data?.drift?.count ?? 0} de {data?.drift?.total ?? 0} keywords com sinal suspeito</p>
                </div>
                <div className="nx-card p-4">
                  <p className="text-xs uppercase text-muted-foreground mb-1">Última mudança</p>
                  {data?.diff ? (
                    <>
                      <p className="text-sm"><span className="text-success font-semibold">+{data.diff.added_keywords.length}</span> · <span className="text-destructive font-semibold">−{data.diff.removed_keywords.length}</span> keywords</p>
                      <p className="text-xs text-muted-foreground mt-1">{data.diff.emerging_tracks} tracks emergentes · {timeAgo(data.diff.last_run_at)}</p>
                    </>
                  ) : <p className="text-xs text-muted-foreground">sem snapshot anterior</p>}
                </div>
                <div className="nx-card p-4">
                  <p className="text-xs uppercase text-muted-foreground mb-1">Winners</p>
                  <p className="text-2xl font-semibold">{data?.total_winners ?? 0}</p>
                  <p className="text-xs text-muted-foreground">com winner_score ≥ 65</p>
                </div>
              </div>

              {/* KEYWORDS */}
              <section className="nx-card p-5">
                <h3 className="font-semibold mb-3 flex items-center gap-2">Keywords aprendidas <Badge variant="outline">{data?.keywords?.length ?? 0}</Badge></h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="text-left py-2">Keyword</th>
                        <th className="text-left">Origem</th>
                        <th className="text-right">Ocorrências</th>
                        <th className="text-right">Cobertura</th>
                        <th className="text-left">Sinais</th>
                        <th className="text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.keywords ?? []).map(k => (
                        <tr key={k.value} className="border-t border-border">
                          <td className="py-2 font-medium">{k.value}</td>
                          <td>
                            <Badge variant={k.source === "wave4" ? "outline" : "secondary"} className="text-[10px]">{k.source}</Badge>
                            {k.locked && <Badge className="ml-1 text-[10px] bg-primary/20 text-primary border-primary/30">travada</Badge>}
                          </td>
                          <td className="text-right">{k.count}</td>
                          <td className="text-right">{k.coverage}%</td>
                          <td className="text-xs text-warning">{k.drift_signals.join(", ") || "—"}</td>
                          <td className="text-right whitespace-nowrap">
                            {!k.locked ? (
                              <Button size="sm" variant="ghost" onClick={() => callGov("lock_keyword", k.value)} disabled={busy !== null}>
                                <Lock className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => callGov("unlock_keyword", k.value)} disabled={busy !== null}>
                                <Unlock className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => callGov("remove_keyword", k.value)} disabled={busy !== null} className="text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {(data?.keywords ?? []).length === 0 && (
                        <tr><td colSpan={6} className="py-6 text-center text-muted-foreground text-sm">Nenhuma keyword aprendida ainda</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ARTISTAS */}
              <section className="nx-card p-5">
                <h3 className="font-semibold mb-3 flex items-center gap-2">Artistas <Badge variant="outline">{data?.artists?.length ?? 0}</Badge></h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {(data?.artists ?? []).map(a => (
                    <div key={a.artista} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-elevated">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm truncate">{a.artista}</span>
                        <Badge variant="outline" className="text-[10px]">{a.count}</Badge>
                        {a.locked && <Badge className="text-[10px] bg-primary/20 text-primary border-primary/30">travado</Badge>}
                      </div>
                      <div className="flex gap-1">
                        {!a.locked ? (
                          <Button size="sm" variant="ghost" onClick={() => callGov("lock_artist", a.artista)} disabled={busy !== null}><Lock className="h-3.5 w-3.5" /></Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => callGov("unlock_artist", a.artista)} disabled={busy !== null}><Unlock className="h-3.5 w-3.5" /></Button>
                        )}
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => callGov("remove_artist", a.artista)} disabled={busy !== null}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  ))}
                  {(data?.artists ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground col-span-2 text-center py-4">Sem artistas aprendidos</p>
                  )}
                </div>
              </section>

              {/* TOP WINNERS + HISTORICO */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <section className="nx-card p-5">
                  <h3 className="font-semibold mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Top winners</h3>
                  <ul className="space-y-2">
                    {(data?.top_winners ?? []).slice(0, 10).map(w => (
                      <li key={w.id} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm truncate">{w.nome}</p>
                          <p className="text-xs text-muted-foreground">{formatNumber(w.seguidores ?? 0)} seguidores · score {w.winner_score}</p>
                        </div>
                        {w.url && <a href={w.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><ExternalLink className="h-3.5 w-3.5" /></a>}
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="nx-card p-5">
                  <h3 className="font-semibold mb-3 flex items-center gap-2"><History className="h-4 w-4" /> Últimas execuções</h3>
                  <ul className="space-y-2">
                    {(data?.history ?? []).map(h => (
                      <li key={h.id} className="flex items-center justify-between gap-2 text-sm">
                        <div>
                          <p>{h.updated ? "✓" : "—"} {h.keywords_added} keywords · {h.winners} winners</p>
                          <p className="text-xs text-muted-foreground">{timeAgo(h.created_at)}{h.reason ? ` · ${h.reason}` : ""}</p>
                        </div>
                      </li>
                    ))}
                    {(data?.history ?? []).length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">Sem execuções registradas</p>
                    )}
                  </ul>
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </Wrapper>
  );
}
