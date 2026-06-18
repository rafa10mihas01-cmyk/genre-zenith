// PlaylistTracksTab — lista faixas atuais via Spotify Web API + ações add/remove via fila.
// Cruza cada faixa com curator_deal_songs (pra marcar "nossa") e curator_deal_snapshots
// (pra mostrar plays 28d). Calcula score_saida pra sugerir remoções.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, Trash2, Plus, RefreshCw, Music2, Clock, AlertCircle, Sparkles, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errors";

type Track = {
  spotify_track_id: string;
  name: string;
  artists: string;
  album_cover: string | null;
  duration_ms: number | null;
  added_at: string | null;
};

type Job = {
  id: string;
  job_type: "playlist.track.add" | "playlist.track.remove";
  spotify_track_id: string;
  status: "pending" | "claimed" | "done" | "failed" | "cancelled";
  attempts: number;
  last_error: string | null;
  created_at: string;
};

type Ownership = {
  is_ours: boolean;
  song_id?: string;
  deal_id?: string;
  song_name?: string;
  plays_28d?: number | null;
  last_snapshot_at?: string | null;
};

function fmtDuration(ms: number | null) {
  if (!ms) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function PlaylistTracksTab({ playlistId }: { playlistId: string }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [ownership, setOwnership] = useState<Map<string, Ownership>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadingOwnership, setLoadingOwnership] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyTrack, setBusyTrack] = useState<string | null>(null);
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<"all" | "ours" | "remove">("all");

  async function loadTracks() {
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("playlist-tracks-list", {
        body: { playlist_id: playlistId },
      });
      // Lê o corpo do erro pra distinguir 404 (playlist removida) de falha real
      let serverError: string | null = null;
      let status: number | null = null;
      if (error && (error as any).context) {
        try {
          const ctx = (error as any).context as Response;
          status = ctx.status ?? null;
          const b = await ctx.clone().json().catch(() => null);
          serverError = b?.error ?? null;
        } catch { /* */ }
      }
      const msg = error?.message ?? "";
      const isNotFound =
        data?.code === "playlist_not_found" ||
        data?.error === "playlist não encontrada" ||
        status === 404 ||
        serverError === "playlist não encontrada" ||
        /404/.test(msg) ||
        /playlist n[aã]o encontrada/i.test(msg);
      if (isNotFound) {
        setTracks([]);
        setErr("Playlist não encontrada no banco (pode ter sido removida).");
        return;
      }
      if (data?.code === "rate_limited") {
        setErr("Spotify limitou as requisições. Tente novamente em alguns segundos.");
        setTracks([]);
        return;
      }
      if (error || !data?.ok) throw new Error(serverError ?? error?.message ?? data?.error ?? "Falhou");
      setTracks(data.tracks ?? []);
    } catch (e: unknown) {
      setErr(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadJobs() {
    const { data } = await supabase
      .from("playlist_execution_jobs")
      .select("id, job_type, spotify_track_id, status, attempts, last_error, created_at")
      .eq("playlist_id", playlistId)
      .in("status", ["pending", "claimed", "failed"])
      .order("created_at", { ascending: false })
      .limit(50);
    setJobs((data ?? []) as Job[]);
  }

  // Cruza faixas com curator_deal_songs (nossas) + último snapshot (plays_28d nesta playlist).
  async function loadOwnership(currentTracks: Track[]) {
    if (currentTracks.length === 0) {
      setOwnership(new Map());
      return;
    }
    setLoadingOwnership(true);
    try {
      const ids = currentTracks.map((t) => t.spotify_track_id).filter(Boolean);
      const { data: songs } = await supabase
        .from("curator_deal_songs")
        .select("id, deal_id, song_name, spotify_track_id")
        .in("spotify_track_id", ids);

      const map = new Map<string, Ownership>();
      const songIds: string[] = [];
      for (const s of songs ?? []) {
        if (!s.spotify_track_id) continue;
        // mantém apenas o primeiro match (uma song por track) — se houver múltiplas, escolhemos a mais recente depois
        if (!map.has(s.spotify_track_id)) {
          map.set(s.spotify_track_id, {
            is_ours: true,
            song_id: s.id,
            deal_id: s.deal_id,
            song_name: s.song_name ?? undefined,
          });
          songIds.push(s.id);
        }
      }

      if (songIds.length > 0) {
        const { data: snaps } = await supabase
          .from("curator_deal_snapshots")
          .select("song_id, plays_28d, captured_at")
          .eq("playlist_id", playlistId)
          .in("song_id", songIds)
          .order("captured_at", { ascending: false })
          .limit(500);

        const latestBySong = new Map<string, { plays_28d: number | null; captured_at: string }>();
        for (const s of snaps ?? []) {
          if (!latestBySong.has(s.song_id)) {
            latestBySong.set(s.song_id, { plays_28d: s.plays_28d ?? null, captured_at: s.captured_at });
          }
        }
        for (const [trackId, own] of map) {
          if (own.song_id && latestBySong.has(own.song_id)) {
            const snap = latestBySong.get(own.song_id)!;
            map.set(trackId, { ...own, plays_28d: snap.plays_28d, last_snapshot_at: snap.captured_at });
          }
        }
      }
      setOwnership(map);
    } catch (e: unknown) {
      console.error("[ownership]", e);
    } finally {
      setLoadingOwnership(false);
    }
  }

  useEffect(() => {
    loadTracks();
    loadJobs();
    const channel = supabase
      .channel(`pej:${playlistId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "playlist_execution_jobs", filter: `playlist_id=eq.${playlistId}` },
        () => loadJobs(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  // Quando tracks carregam, dispara cruzamento de ownership
  useEffect(() => {
    if (tracks.length > 0 && !loading) loadOwnership(tracks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, loading]);

  async function enqueue(action: "add" | "remove", spotify_track_id: string) {
    setBusyTrack(spotify_track_id);
    try {
      const { data, error } = await supabase.functions.invoke("enqueue-playlist-job", {
        body: { playlist_id: playlistId, spotify_track_id, action },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      toast({
        title: action === "add" ? "Faixa enfileirada para adicionar" : "Faixa enfileirada para remover",
        description: action === "remove"
          ? "O bot vai processar quando o handler de remove estiver online."
          : "O bot vai processar nos próximos minutos.",
      });
      loadJobs();
    } catch (e: unknown) {
      toast({ title: "Erro ao enfileirar", description: getErrorMessage(e), variant: "destructive" });
    } finally {
      setBusyTrack(null);
    }
  }

  async function handleAdd() {
    if (!addInput.trim()) return;
    setAdding(true);
    try {
      const { data, error } = await supabase.functions.invoke("enqueue-playlist-job", {
        body: { playlist_id: playlistId, spotify_track_id: addInput.trim(), action: "add" },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      toast({ title: "Faixa enfileirada", description: "O bot vai adicionar nos próximos minutos." });
      setAddInput("");
      loadJobs();
    } catch (e: unknown) {
      toast({ title: "Não consegui enfileirar", description: getErrorMessage(e), variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  const pendingByTrack = useMemo(() => {
    const m = new Map<string, Job>();
    for (const j of jobs) if (!m.has(j.spotify_track_id)) m.set(j.spotify_track_id, j);
    return m;
  }, [jobs]);

  // Score de remoção: 0..100. Maior = melhor candidata a sair.
  // - idade na playlist (>180d pesa muito) → 50%
  // - performance baixa para faixas nossas (poucos plays_28d) → 30%
  // - posição no fundo da lista → 20%
  const scored = useMemo(() => {
    const total = tracks.length || 1;
    return tracks.map((t, i) => {
      const own = ownership.get(t.spotify_track_id);
      const ageDays = daysSince(t.added_at);
      const ageScore = ageDays == null ? 0 : Math.min(1, ageDays / 365); // 1 ano = pico
      const positionScore = i / total; // 0 (topo) → 1 (fundo)

      let perfScore = 0;
      if (own?.is_ours) {
        const p = own.plays_28d ?? null;
        if (p == null) perfScore = 0.5; // sem dado = neutro
        else if (p < 50) perfScore = 1;
        else if (p < 200) perfScore = 0.7;
        else if (p < 1000) perfScore = 0.3;
        else perfScore = 0; // bombando = não tira
      } else {
        // não é nossa → não decidimos remover por performance
        perfScore = 0.4;
      }

      const score = Math.round((ageScore * 0.5 + perfScore * 0.3 + positionScore * 0.2) * 100);
      return { track: t, index: i, ownership: own, ageDays, score };
    });
  }, [tracks, ownership]);

  const removeCandidates = useMemo(() => {
    return [...scored].sort((a, b) => b.score - a.score).slice(0, 20).map((s) => s.track.spotify_track_id);
  }, [scored]);
  const removeSet = useMemo(() => new Set(removeCandidates), [removeCandidates]);

  const visible = useMemo(() => {
    if (filter === "ours") return scored.filter((s) => s.ownership?.is_ours);
    if (filter === "remove") return scored.filter((s) => removeSet.has(s.track.spotify_track_id))
      .sort((a, b) => b.score - a.score);
    return scored;
  }, [scored, filter, removeSet]);

  const oursCount = useMemo(() => scored.filter((s) => s.ownership?.is_ours).length, [scored]);

  return (
    <div className="space-y-4">
      {/* Adicionar faixa */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Adicionar faixa</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Cole a URL do Spotify, URI (<code className="px-1 rounded bg-muted">spotify:track:…</code>) ou o ID de 22 caracteres.
        </p>
        <div className="flex gap-2">
          <Input
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder="https://open.spotify.com/track/…"
            disabled={adding}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          <Button onClick={handleAdd} disabled={adding || !addInput.trim()} className="nx-pill">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span className="ml-1.5">Enfileirar</span>
          </Button>
        </div>
      </Card>

      {/* Jobs ativos */}
      {jobs.length > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-warning" />
            <h2 className="text-sm font-semibold">Ações na fila</h2>
            <span className="text-xs text-muted-foreground">{jobs.length}</span>
          </div>
          <ul className="space-y-1.5 text-xs">
            {jobs.slice(0, 10).map((j) => (
              <li key={j.id} className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {j.job_type === "playlist.track.add" ? "ADD" : "REMOVE"}
                </Badge>
                <span className="font-mono text-[11px] text-muted-foreground truncate">{j.spotify_track_id}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] ml-auto",
                    j.status === "pending" && "text-muted-foreground",
                    j.status === "claimed" && "text-primary border-primary/40",
                    j.status === "failed" && "text-destructive border-destructive/40",
                  )}
                >
                  {j.status}{j.attempts > 0 ? ` (${j.attempts})` : ""}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Resumo do cruzamento + filtros */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Cruzamento com nosso catálogo</h2>
          {loadingOwnership && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-md border border-border p-2.5">
            <div className="text-muted-foreground">Total faixas</div>
            <div className="text-base font-semibold tabular-nums">{tracks.length}</div>
          </div>
          <div className="rounded-md border border-border p-2.5">
            <div className="text-muted-foreground">Nossas</div>
            <div className="text-base font-semibold tabular-nums text-primary">{oursCount}</div>
          </div>
          <div className="rounded-md border border-border p-2.5">
            <div className="text-muted-foreground">Terceiros</div>
            <div className="text-base font-semibold tabular-nums">{tracks.length - oursCount}</div>
          </div>
          <div className="rounded-md border border-border p-2.5">
            <div className="text-muted-foreground">Sugerir remover</div>
            <div className="text-base font-semibold tabular-nums text-destructive">{removeCandidates.length}</div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap pt-1">
          <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")} className="nx-pill h-7 text-xs">
            Todas
          </Button>
          <Button size="sm" variant={filter === "ours" ? "default" : "outline"} onClick={() => setFilter("ours")} className="nx-pill h-7 text-xs">
            Só nossas ({oursCount})
          </Button>
          <Button size="sm" variant={filter === "remove" ? "default" : "outline"} onClick={() => setFilter("remove")} className="nx-pill h-7 text-xs">
            Sugerir remoções ({removeCandidates.length})
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Score de remoção combina: idade na playlist (50%) · performance baixa em plays 28d quando é nossa (30%) · posição no fundo (20%).
          Faixas com muitos plays nunca aparecem.
        </p>
      </Card>

      {/* Lista de faixas */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Music2 className="h-4 w-4" />
          <h2 className="text-sm font-semibold">
            {filter === "ours" ? "Faixas nossas" : filter === "remove" ? "Candidatas a remover" : "Faixas atuais"}
          </h2>
          {!loading && <span className="text-xs text-muted-foreground">{visible.length}</span>}
          <Button
            variant="outline"
            size="sm"
            onClick={() => { loadTracks(); loadJobs(); }}
            disabled={loading}
            className="ml-auto nx-pill"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            <span className="ml-1.5">Atualizar</span>
          </Button>
        </div>

        {err && (
          <div className="flex items-start gap-2 text-sm text-destructive p-3 rounded-md border border-destructive/30 bg-destructive/5">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {loading ? (
          <div className="h-32 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : visible.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            {filter === "all" ? "Nenhuma faixa nesta playlist." : "Nenhuma faixa neste filtro."}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map(({ track: t, index: i, ownership: own, ageDays, score }) => {
              const pendingJob = pendingByTrack.get(t.spotify_track_id);
              const isPendingRemove = pendingJob?.job_type === "playlist.track.remove";
              const isCandidate = removeSet.has(t.spotify_track_id);
              return (
                <li key={`${t.spotify_track_id}-${i}`} className={cn(
                  "py-2 flex items-center gap-3",
                  filter === "all" && isCandidate && "bg-destructive/5 -mx-2 px-2 rounded",
                )}>
                  <span className="w-6 text-right text-xs text-muted-foreground tabular-nums shrink-0">{i + 1}</span>
                  {t.album_cover ? (
                    <img src={t.album_cover} alt="" className="h-9 w-9 rounded object-cover shrink-0" />
                  ) : (
                    <div className="h-9 w-9 rounded bg-muted shrink-0 grid place-items-center">
                      <Music2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate flex items-center gap-1.5">
                      {t.name}
                      {own?.is_ours && (
                        <span title="Faixa do nosso catálogo">
                          <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate flex items-center gap-2">
                      <span className="truncate">{t.artists}</span>
                      {own?.is_ours && own.plays_28d != null && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1 border-primary/30 text-primary shrink-0">
                          {fmtNum(own.plays_28d)} plays/28d
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="hidden md:block text-xs text-muted-foreground tabular-nums shrink-0 w-16 text-right">
                    {ageDays != null ? `${ageDays}d` : "—"}
                  </div>
                  <div className="hidden sm:block text-xs text-muted-foreground tabular-nums shrink-0 w-20 text-right">
                    {fmtDate(t.added_at)}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums shrink-0 w-12 text-right">
                    {fmtDuration(t.duration_ms)}
                  </div>
                  {isCandidate && (
                    <Badge variant="outline" className="text-[10px] h-5 border-destructive/40 text-destructive shrink-0 hidden sm:inline-flex">
                      Sair {score}
                    </Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyTrack === t.spotify_track_id || isPendingRemove}
                    onClick={() => enqueue("remove", t.spotify_track_id)}
                    className="nx-pill text-destructive hover:text-destructive"
                  >
                    {busyTrack === t.spotify_track_id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                    <span className="ml-1.5 hidden sm:inline">
                      {isPendingRemove ? "Na fila" : "Remover"}
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-[11px] text-muted-foreground pt-2 border-t border-border">
          Heads-up: o handler de <strong>remove</strong> ainda está sendo implementado no bot VPS.
          Jobs de remoção ficam <em>pending</em> até o handler entrar em produção.
        </p>
      </Card>
    </div>
  );
}
