import { useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Radio, Play, Square, Sparkles, Pause, ChevronRight, ListChecks, Globe2, Brain, RotateCcw, Music2 } from "lucide-react";
import { toast } from "sonner";
import { collectGenre, generateTerms } from "@/lib/engine";
import { StatusBadge } from "@/components/StatusBadge";
import { timeAgo } from "@/lib/format";
import { getCollectSettings } from "@/pages/Settings";

const GLOBAL_STATE_KEY = "nx-global-collection-v1";
const BATCH_SIZE = 5;

interface GlobalState {
  queue: string[];        // ordered ids still to process
  done: string[];         // ids already processed
  totalPlaylists: number;
  totalTracks: number;
  totalGenres: number;    // snapshot of initial size
  startedAt: number;
  lastBatchAt: number | null;
  lastBatchDurationMs: number | null;
}

function loadGlobal(): GlobalState | null {
  try { const r = localStorage.getItem(GLOBAL_STATE_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function saveGlobal(s: GlobalState | null) {
  if (s) localStorage.setItem(GLOBAL_STATE_KEY, JSON.stringify(s));
  else localStorage.removeItem(GLOBAL_STATE_KEY);
}

interface LogRow {
  id: string;
  acao: string;
  status: string;
  mensagem: string | null;
  created_at: string;
}

interface Genre { id: string; nome: string; status: string; total_termos: number; }

export default function Collect() {
  const [params] = useSearchParams();
  const initialGenre = params.get("genre");
  const queueParam = params.get("queue");

  const [genres, setGenres] = useState<Genre[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialGenre);
  const [queue, setQueue] = useState<string[]>(queueParam ? queueParam.split(",") : initialGenre ? [initialGenre] : []);
  const [progress, setProgress] = useState({ done: 0, total: 0, term: "" });
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // ===== Global collection state (lotes manuais) =====
  const [globalState, setGlobalState] = useState<GlobalState | null>(loadGlobal());
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ idx: number; size: number; nome: string } | null>(null);
  const [insightsRunning, setInsightsRunning] = useState(false);
  const [enrichRunning, setEnrichRunning] = useState(false);
  const [pendingEnrich, setPendingEnrich] = useState<number>(0);

  // Conta playlists pendentes de enrich (seguidores IS NULL)
  const refreshPendingEnrich = async (gid?: string | null) => {
    let q = supabase
      .from("search_results")
      .select("*", { count: "exact", head: true })
      .is("seguidores", null)
      .not("spotify_url", "is", null);
    if (gid) q = q.eq("genre_id", gid);
    const { count } = await q;
    setPendingEnrich(count ?? 0);
  };

  const runEnrich = async (scope: "active" | "all") => {
    if (scope === "active" && !activeId) {
      toast.error("Selecione um gênero primeiro");
      return;
    }
    setEnrichRunning(true);
    toast.info(scope === "active" ? "Enriquecendo gênero ativo…" : "Enriquecendo todos os pendentes…",
      { description: "Pode levar alguns minutos. Acompanhe nos logs." });
    try {
      const body: any = { limit: 50, fetch_tracks: true };
      if (scope === "active") body.genre_id = activeId;
      const { data, error } = await supabase.functions.invoke("enrich-playlists", { body });
      if (error) throw error;
      toast.success("Enriquecimento concluído", {
        description: `${data?.enriched ?? 0} playlists, ${data?.tracks_saved ?? 0} tracks${data?.errors ? `, ${data.errors} erros` : ""}`,
      });
      // Re-analisa o gênero ativo se aplicável
      if (scope === "active" && activeId) {
        await supabase.functions.invoke("analyze-genre", { body: { genre_id: activeId } });
        toast.success("Modelo re-analisado");
      }
      await refreshPendingEnrich(scope === "active" ? activeId : null);
    } catch (e: any) {
      toast.error("Erro no enriquecimento", { description: e.message?.slice(0, 150) });
    }
    setEnrichRunning(false);
  };

  const initGlobal = async () => {
    const { data } = await supabase.from("genres").select("id").eq("ativo", true).order("nome");
    const ids = (data ?? []).map((g) => g.id);
    if (ids.length === 0) { toast.error("Nenhum gênero ativo"); return; }
    const fresh: GlobalState = {
      queue: ids, done: [], totalPlaylists: 0, totalTracks: 0,
      totalGenres: ids.length, startedAt: Date.now(),
      lastBatchAt: null, lastBatchDurationMs: null,
    };
    setGlobalState(fresh);
    saveGlobal(fresh);
    toast.success(`Coleta global iniciada`, { description: `${ids.length} gêneros na fila` });
  };

  const resetGlobal = () => {
    setGlobalState(null);
    saveGlobal(null);
    toast.info("Estado da coleta global resetado");
  };

  const processNextBatch = async () => {
    if (!globalState || globalState.queue.length === 0) return;
    setBatchRunning(true);
    const batchIds = globalState.queue.slice(0, BATCH_SIZE);
    const cfg = getCollectSettings();
    const t0 = Date.now();
    setBatchProgress({ idx: 0, size: batchIds.length, nome: "iniciando…" });

    let saved = 0, tracks = 0;
    const newDone: string[] = [];

    for (let i = 0; i < batchIds.length; i++) {
      const gid = batchIds[i];
      const g = genres.find((x) => x.id === gid);
      setBatchProgress({ idx: i + 1, size: batchIds.length, nome: g?.nome ?? "?" });
      try {
        const { data, error } = await supabase.functions.invoke("collect-batch", {
          body: {
            genre_ids: [gid],
            terms_per_genre: 10,
            max_results: cfg.max_results ?? 25,
            delay_ms: cfg.delay_ms ?? 2000,
          },
        });
        if (error) throw error;
        saved += data?.total_playlists ?? 0;
        tracks += data?.total_tracks ?? 0;
        newDone.push(gid);
      } catch (e: any) {
        toast.error(`Erro em ${g?.nome}`, { description: e.message?.slice(0, 100) });
      }
    }

    const next: GlobalState = {
      ...globalState,
      queue: globalState.queue.slice(newDone.length),
      done: [...globalState.done, ...newDone],
      totalPlaylists: globalState.totalPlaylists + saved,
      totalTracks: globalState.totalTracks + tracks,
      lastBatchAt: Date.now(),
      lastBatchDurationMs: Date.now() - t0,
    };
    setGlobalState(next);
    saveGlobal(next);
    setBatchRunning(false);
    setBatchProgress(null);

    const { data: gData } = await supabase.from("genres").select("id,nome,status,total_termos").order("nome");
    setGenres(gData ?? []);

    toast.success(`Lote concluído`, {
      description: `+${saved} playlists, +${tracks} tracks. ${next.queue.length} gêneros restantes.`,
    });
  };

  const runInsightsTop10 = async () => {
    setInsightsRunning(true);
    const { data: top } = await supabase
      .from("genres")
      .select("id,nome,total_playlists")
      .order("total_playlists", { ascending: false })
      .limit(10);

    let ok = 0, err = 0;
    for (const g of top ?? []) {
      try {
        const { error } = await supabase.functions.invoke("genre-insights", { body: { genre_id: g.id } });
        if (error) throw error;
        ok++;
      } catch { err++; }
    }
    setInsightsRunning(false);
    toast.success(`Insights IA gerados`, { description: `${ok} ok, ${err} erros (top 10 gêneros)` });
  };

  // Load genre list
  useEffect(() => {
    supabase
      .from("genres")
      .select("id,nome,status,total_termos")
      .order("nome")
      .then(({ data }) => setGenres(data ?? []));
  }, []);

  // Atualiza contador de pendentes ao mudar gênero ativo
  useEffect(() => { void refreshPendingEnrich(activeId); }, [activeId]);
  useEffect(() => {
    const fetchLogs = async () => {
      const { data } = await supabase
        .from("collection_logs")
        .select("id,acao,status,mensagem,created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      setLogs(data ?? []);
    };
    fetchLogs();
    const t = setInterval(fetchLogs, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const activeGenre = genres.find((g) => g.id === activeId);

  const start = async () => {
    if (!activeId) {
      toast.error("Selecione um gênero primeiro");
      return;
    }
    setRunning(true);
    setPaused(false);
    setStartedAt(Date.now());
    abortRef.current = new AbortController();

    // Process the queue (or just the active id)
    const list = queue.length > 0 ? queue : [activeId];
    for (const gid of list) {
      if (abortRef.current?.signal.aborted) break;
      setActiveId(gid);
      const cfg = getCollectSettings();
      await collectGenre(gid, {
        delayMs: cfg.delay_ms,
        maxResults: cfg.max_results,
        onProgress: (done, total, term) => setProgress({ done, total, term }),
        abortSignal: abortRef.current?.signal,
      });
    }
    setRunning(false);
    setProgress({ done: 0, total: 0, term: "" });
  };

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
    toast.info("Parando coleta…");
  };

  const generateForActive = async () => {
    if (!activeId) return;
    await generateTerms(activeId);
    const { data } = await supabase.from("genres").select("id,nome,status,total_termos").order("nome");
    setGenres(data ?? []);
  };

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const eta = startedAt && progress.done > 0 && progress.total > 0
    ? Math.round(((Date.now() - startedAt) / progress.done) * (progress.total - progress.done) / 1000)
    : null;

  // Global pct + ETA
  const globalDone = globalState?.done.length ?? 0;
  const globalTotal = globalState?.totalGenres ?? 0;
  const globalPct = globalTotal > 0 ? Math.round((globalDone / globalTotal) * 100) : 0;
  const globalEtaSec = globalState?.lastBatchDurationMs && globalState.queue.length > 0
    ? Math.round((globalState.lastBatchDurationMs / BATCH_SIZE) * globalState.queue.length / 1000)
    : null;
  const fmtEta = (s: number) => s > 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Radio className={`h-6 w-6 text-primary ${running ? "animate-pulse-soft" : ""}`} /> Coleta ao Vivo
          </h1>
          <p className="text-sm text-muted-foreground">Monitor em tempo real da execução das coletas Apify</p>
        </div>
      </div>

      {/* === GLOBAL COLLECTION PANEL === */}
      <div className="nx-card p-5 border-primary/30 bg-primary/5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Globe2 className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-semibold">Coleta Global — todos os gêneros</h2>
              <p className="text-xs text-muted-foreground">
                Lotes de {BATCH_SIZE} gêneros · 10 termos cada · 25 playlists/termo · analyze automático
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!globalState ? (
              <Button onClick={initGlobal} className="gap-2">
                <Play className="h-4 w-4" /> Iniciar coleta global
              </Button>
            ) : globalState.queue.length === 0 ? (
              <>
                <Button onClick={runInsightsTop10} disabled={insightsRunning} className="gap-2">
                  <Brain className="h-4 w-4" /> {insightsRunning ? "Gerando insights…" : "Gerar Insights IA (Top 10)"}
                </Button>
                <Button onClick={resetGlobal} variant="outline" size="sm" className="gap-2">
                  <RotateCcw className="h-3.5 w-3.5" /> Resetar
                </Button>
              </>
            ) : (
              <>
                <Button onClick={processNextBatch} disabled={batchRunning} className="gap-2">
                  <Play className="h-4 w-4" />
                  {batchRunning ? "Processando…" : `Processar próximo lote (${Math.min(BATCH_SIZE, globalState.queue.length)} gêneros)`}
                </Button>
                <Button onClick={resetGlobal} variant="ghost" size="sm" disabled={batchRunning} className="gap-2">
                  <RotateCcw className="h-3.5 w-3.5" /> Resetar
                </Button>
              </>
            )}
          </div>
        </div>

        {globalState && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-background border border-border rounded-md p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Progresso</div>
                <div className="text-xl font-bold tabular-nums">{globalDone}/{globalTotal}</div>
                <div className="text-[11px] text-muted-foreground">{globalPct}%</div>
              </div>
              <div className="bg-background border border-border rounded-md p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Playlists coletadas</div>
                <div className="text-xl font-bold tabular-nums text-primary">{globalState.totalPlaylists}</div>
              </div>
              <div className="bg-background border border-border rounded-md p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Tracks coletadas</div>
                <div className="text-xl font-bold tabular-nums">{globalState.totalTracks}</div>
              </div>
              <div className="bg-background border border-border rounded-md p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ETA restante</div>
                <div className="text-xl font-bold tabular-nums">
                  {globalState.queue.length === 0 ? "✓" : globalEtaSec ? fmtEta(globalEtaSec) : "—"}
                </div>
                <div className="text-[11px] text-muted-foreground">{globalState.queue.length} restantes</div>
              </div>
            </div>
            <Progress value={globalPct} className="h-2" />
            {batchProgress && (
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
                Processando <span className="text-foreground font-medium">{batchProgress.nome}</span> ({batchProgress.idx}/{batchProgress.size} do lote)
              </div>
            )}
            {globalState.queue.length === 0 && (
              <div className="text-sm text-success font-medium">
                ✓ Coleta global concluída — {globalState.totalPlaylists} playlists em {globalState.totalGenres} gêneros
              </div>
            )}
          </div>
        )}
      </div>

      {/* === ENRICH PANEL === */}
      <div className="nx-card p-5 border-accent/30 bg-accent/5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Music2 className="h-5 w-5 text-accent" />
            <div>
              <h2 className="font-semibold">Enriquecer playlists — Spotify Web API</h2>
              <p className="text-xs text-muted-foreground">
                Busca seguidores reais (Spotify oficial) + lista de músicas (Apify). Re-analisa o gênero ao final.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted text-foreground border border-border text-xs font-mono">
              {pendingEnrich} {activeId ? "no gênero ativo" : "no total"} aguardando
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runEnrich("active")}
              disabled={enrichRunning || !activeId || pendingEnrich === 0}
              className="gap-2"
            >
              {enrichRunning ? <Sparkles className="h-4 w-4 animate-spin" /> : <Music2 className="h-4 w-4" />}
              Enriquecer gênero ativo
            </Button>
            <Button
              size="sm"
              onClick={() => runEnrich("all")}
              disabled={enrichRunning}
              className="gap-2"
            >
              {enrichRunning ? <Sparkles className="h-4 w-4 animate-spin" /> : <Music2 className="h-4 w-4" />}
              Enriquecer 50 (todos os gêneros)
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Status panel */}
        <div className="nx-card p-5 lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Gênero ativo</div>
              <div className="text-xl font-bold mt-0.5">
                {activeGenre?.nome ?? "Nenhum selecionado"}
              </div>
            </div>
            {activeGenre && <StatusBadge status={running ? "coletando" : activeGenre.status} />}
          </div>

          {running && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate">
                  Termo atual: <span className="text-foreground font-medium">{progress.term || "—"}</span>
                </span>
                <span className="tabular-nums">{progress.done} / {progress.total}</span>
              </div>
              <Progress value={pct} className="h-2" />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{pct}%</span>
                {eta !== null && <span>ETA: ~{eta}s</span>}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            {!running ? (
              <Button onClick={start} disabled={!activeId} className="gap-2">
                <Play className="h-4 w-4" /> Iniciar coleta
              </Button>
            ) : (
              <>
                <Button onClick={() => { setPaused(!paused); toast.info(paused ? "Retomado" : "Pausa será aplicada após o termo atual"); }} variant="outline" className="gap-2">
                  <Pause className="h-4 w-4" /> {paused ? "Retomar" : "Pausar"}
                </Button>
                <Button onClick={stop} variant="destructive" className="gap-2">
                  <Square className="h-4 w-4" /> Parar
                </Button>
              </>
            )}
            <Button onClick={generateForActive} variant="ghost" disabled={!activeId || running} className="gap-2">
              <Sparkles className="h-4 w-4" /> Gerar termos
            </Button>
          </div>

          {queue.length > 1 && (
            <div className="text-xs text-muted-foreground border-t border-border pt-3 flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5" /> Fila: {queue.length} gêneros
              {queue.map((id, i) => {
                const g = genres.find((x) => x.id === id);
                return (
                  <span key={id} className="flex items-center gap-1">
                    <span className={id === activeId ? "text-primary font-medium" : ""}>{g?.nome ?? "?"}</span>
                    {i < queue.length - 1 && <ChevronRight className="h-3 w-3" />}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Genre picker */}
        <div className="nx-card p-5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Selecionar gênero</div>
          <div className="max-h-[280px] overflow-y-auto space-y-1 pr-1">
            {genres.map((g) => (
              <button
                key={g.id}
                onClick={() => { setActiveId(g.id); setQueue([g.id]); }}
                className={`w-full text-left px-2.5 py-1.5 rounded-md text-sm flex items-center justify-between transition-colors ${
                  activeId === g.id ? "bg-primary/15 text-primary border border-primary/30" : "hover:bg-elevated border border-transparent"
                }`}
              >
                <span>{g.nome}</span>
                <span className="text-[10px] text-muted-foreground">{g.total_termos}t</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live logs */}
      <div className="nx-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Feed de logs</h2>
          <Link to="/logs" className="text-xs text-primary hover:underline">Ver todos →</Link>
        </div>
        <div className="bg-background border border-border rounded-md p-3 max-h-[400px] overflow-y-auto font-mono text-[11px] space-y-1">
          {logs.length === 0 && <div className="text-muted-foreground text-center py-6">Sem logs ainda…</div>}
          {logs.slice().reverse().map((l) => (
            <div key={l.id} className="flex items-start gap-2">
              <span className={`shrink-0 ${l.status === "erro" ? "text-destructive" : l.status === "sucesso" ? "text-success" : "text-primary"}`}>
                ●
              </span>
              <span className="text-muted-foreground shrink-0">{timeAgo(l.created_at)}</span>
              <span className="text-foreground/70 shrink-0">[{l.acao}]</span>
              <span className={l.status === "erro" ? "text-destructive" : "text-foreground"}>{l.mensagem}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}
