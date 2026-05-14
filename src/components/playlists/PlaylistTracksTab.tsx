// PlaylistTracksTab — lista faixas atuais via Spotify Web API + ações add/remove via fila.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, Trash2, Plus, RefreshCw, Music2, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

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

export function PlaylistTracksTab({ playlistId }: { playlistId: string }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyTrack, setBusyTrack] = useState<string | null>(null);
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);

  async function loadTracks() {
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("playlist-tracks-list", {
        body: { playlist_id: playlistId },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      setTracks(data.tracks ?? []);
    } catch (e: any) {
      setErr(e.message);
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
    } catch (e: any) {
      toast({ title: "Erro ao enfileirar", description: e.message, variant: "destructive" });
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
    } catch (e: any) {
      toast({ title: "Não consegui enfileirar", description: e.message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  const pendingByTrack = useMemo(() => {
    const m = new Map<string, Job>();
    for (const j of jobs) if (!m.has(j.spotify_track_id)) m.set(j.spotify_track_id, j);
    return m;
  }, [jobs]);

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

      {/* Lista de faixas */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Music2 className="h-4 w-4" />
          <h2 className="text-sm font-semibold">Faixas atuais</h2>
          {!loading && <span className="text-xs text-muted-foreground">{tracks.length}</span>}
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
        ) : tracks.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Nenhuma faixa nesta playlist.</div>
        ) : (
          <ul className="divide-y divide-border">
            {tracks.map((t, i) => {
              const pendingJob = pendingByTrack.get(t.spotify_track_id);
              const isPendingRemove = pendingJob?.job_type === "playlist.track.remove";
              return (
                <li key={`${t.spotify_track_id}-${i}`} className="py-2 flex items-center gap-3">
                  <span className="w-6 text-right text-xs text-muted-foreground tabular-nums shrink-0">{i + 1}</span>
                  {t.album_cover ? (
                    <img src={t.album_cover} alt="" className="h-9 w-9 rounded object-cover shrink-0" />
                  ) : (
                    <div className="h-9 w-9 rounded bg-muted shrink-0 grid place-items-center">
                      <Music2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{t.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{t.artists}</div>
                  </div>
                  <div className="hidden sm:block text-xs text-muted-foreground tabular-nums shrink-0 w-20 text-right">
                    {fmtDate(t.added_at)}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums shrink-0 w-12 text-right">
                    {fmtDuration(t.duration_ms)}
                  </div>
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
