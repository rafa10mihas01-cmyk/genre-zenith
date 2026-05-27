// PlaylistEditorTab — editor visual da playlist com posições numeradas (1-indexadas),
// drag-and-drop pra reordenar (dnd-kit/sortable), botão + por posição pra adicionar
// faixa naquela posição, lixeira por linha pra remover, badge "pendente" por linha
// quando há job na fila pra aquela faixa.
//
// Reordenar dispara job 'playlist.track.reorder' (executado server-side em
// bot-execution-queue chamando Spotify reorderPlaylistTracks).
// Adicionar/Remover dispara jobs 'playlist.track.add'/'remove' (executados pelo bot VPS).
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  Loader2, Trash2, Plus, RefreshCw, GripVertical, ListMusic, AlertCircle, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
  job_type: "playlist.track.add" | "playlist.track.remove" | "playlist.track.reorder";
  spotify_track_id: string;
  status: "pending" | "claimed" | "done" | "failed" | "cancelled";
  from_position: number | null;
  to_position: number | null;
};

function fmtDuration(ms: number | null) {
  if (!ms) return "—";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function fmtTotalDuration(ms: number) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

type PlaylistMeta = {
  name: string | null;
  cover_url: string | null;
};

function SortableRow({
  track, position, pendingJob, onRemove, onAddAt, busy,
}: {
  track: Track;
  position: number;
  pendingJob?: Job;
  onRemove: (id: string) => void;
  onAddAt: (position: number) => void;
  busy: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: track.spotify_track_id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

  const pendingLabel = pendingJob
    ? pendingJob.job_type === "playlist.track.remove" ? "removendo"
      : pendingJob.job_type === "playlist.track.reorder" ? "reordenando"
      : "adicionando"
    : null;

  return (
    <li ref={setNodeRef} style={style} className="group/row relative">
      {/* Botão + acima da linha (insere nesta posição) */}
      <button
        type="button"
        onClick={() => onAddAt(position)}
        className="absolute -top-1.5 left-1/2 -translate-x-1/2 z-20 h-5 w-5 rounded-full bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground border border-primary/30 opacity-0 group-hover/row:opacity-100 transition-opacity grid place-items-center"
        title={`Adicionar na posição ${position}`}
      >
        <Plus className="h-3 w-3" />
      </button>

      <div className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-muted/40 transition-colors">
        {/* Posição / drag handle no hover */}
        <div className="w-8 shrink-0 grid place-items-center">
          <span className="tabular-nums text-sm text-muted-foreground group-hover/row:hidden">
            {position}
          </span>
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="hidden group-hover/row:grid place-items-center cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
            aria-label="Arrastar"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </div>

        {/* Capa */}
        {track.album_cover ? (
          <img src={track.album_cover} alt="" className="h-10 w-10 rounded object-cover shrink-0" />
        ) : (
          <div className="h-10 w-10 rounded bg-muted shrink-0" />
        )}

        {/* Metadados */}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground truncate">{track.name}</div>
          <div className="text-xs text-muted-foreground truncate">{track.artists}</div>
        </div>

        {/* Badge pendente */}
        {pendingLabel && (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              pendingJob?.status === "failed"
                ? "text-destructive border-destructive/40"
                : "text-warning border-warning/40",
            )}
          >
            <Clock className="h-3 w-3 mr-1" />
            {pendingJob?.status === "failed" ? `falhou (${pendingLabel})` : pendingLabel}
          </Badge>
        )}

        {/* Duração */}
        <div className="text-xs text-muted-foreground tabular-nums hidden sm:block w-12 text-right">
          {fmtDuration(track.duration_ms)}
        </div>

        {/* Remover — só no hover */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover/row:opacity-100 transition-opacity"
          disabled={busy || !!pendingJob}
          onClick={() => onRemove(track.spotify_track_id)}
          title="Remover faixa"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </li>
  );
}

export function PlaylistEditorTab({ playlistId }: { playlistId: string }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyTrack, setBusyTrack] = useState<string | null>(null);
  const [meta, setMeta] = useState<PlaylistMeta>({ name: null, cover_url: null });

  // Dialog "Adicionar na posição X"
  const [addOpen, setAddOpen] = useState(false);
  const [addPosition, setAddPosition] = useState<number>(1);
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);

  // Trava cliques duplos sub-200ms — antes do estado React propagar pro disabled
  const inFlight = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function loadTracks() {
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("playlist-tracks-list", {
        body: { playlist_id: playlistId },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) {
        if (data?.code === "rate_limited") {
          setErr("Spotify limitou as requisições. Tente novamente em alguns segundos.");
          setTracks([]);
          return;
        }
        throw new Error(data?.error ?? "Falhou");
      }
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
      .select("id, job_type, spotify_track_id, status, from_position, to_position")
      .eq("playlist_id", playlistId)
      .in("status", ["pending", "claimed", "failed"])
      .order("created_at", { ascending: false })
      .limit(100);
    setJobs((data ?? []) as Job[]);
  }

  async function loadMeta() {
    const { data } = await supabase
      .from("managed_playlists")
      .select("name, cover_url")
      .eq("id", playlistId)
      .maybeSingle();
    if (data) setMeta({ name: data.name ?? null, cover_url: (data as any).cover_url ?? null });
  }

  useEffect(() => {
    loadTracks();
    loadJobs();
    loadMeta();
    const channel = supabase
      .channel(`pej-editor:${playlistId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "playlist_execution_jobs", filter: `playlist_id=eq.${playlistId}` },
        (payload: any) => {
          loadJobs();
          const row = payload?.new;
          if (!row || row.status !== "done") return;
          const trackId = row.spotify_track_id as string;
          if (row.job_type === "playlist.track.remove") {
            setTracks((prev) => prev.filter((t) => t.spotify_track_id !== trackId));
          } else if (row.job_type === "playlist.track.reorder") {
            const from = Number(row.from_position);
            const to = Number(row.to_position);
            if (Number.isFinite(from) && Number.isFinite(to) && from >= 1 && to >= 1) {
              setTracks((prev) => {
                const idx = prev.findIndex((t) => t.spotify_track_id === trackId);
                const targetIdx = to - 1;
                if (idx === -1 || idx === targetIdx) return prev;
                return arrayMove(prev, idx, targetIdx);
              });
            }
          } else if (row.job_type === "playlist.track.add") {
            // Refetch pra obter metadata rica (nome, capa, duração) da nova faixa
            loadTracks();
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  const pendingByTrack = useMemo(() => {
    const m = new Map<string, Job>();
    for (const j of jobs) if (!m.has(j.spotify_track_id)) m.set(j.spotify_track_id, j);
    return m;
  }, [jobs]);

  const totalDurationMs = useMemo(
    () => tracks.reduce((acc, t) => acc + (t.duration_ms ?? 0), 0),
    [tracks],
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (inFlight.current) return;
    const oldIndex = tracks.findIndex((t) => t.spotify_track_id === active.id);
    const newIndex = tracks.findIndex((t) => t.spotify_track_id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Otimista: reordena localmente
    const previous = tracks;
    setTracks((prev) => arrayMove(prev, oldIndex, newIndex));

    // Posições 1-indexadas para o backend
    const from = oldIndex + 1;
    const to = newIndex + 1;
    setBusyTrack(String(active.id));
    try {
      const { data, error } = await supabase.functions.invoke("enqueue-playlist-job", {
        body: {
          playlist_id: playlistId,
          spotify_track_id: String(active.id),
          action: "reorder",
          from_position: from,
          to_position: to,
        },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      toast({
        title: "Reordenação enfileirada",
        description: `Posição ${from} → ${to}. Processada nos próximos segundos.`,
      });
      loadJobs();
    } catch (e: any) {
      setTracks(previous); // rollback
      toast({ title: "Não consegui reordenar", description: e.message, variant: "destructive" });
    } finally {
      setBusyTrack(null);
    }
  }

  async function handleRemove(spotify_track_id: string) {
    setBusyTrack(spotify_track_id);
    try {
      const { data, error } = await supabase.functions.invoke("enqueue-playlist-job", {
        body: { playlist_id: playlistId, spotify_track_id, action: "remove" },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      toast({ title: "Remoção enfileirada", description: "Bot vai processar em instantes." });
      loadJobs();
    } catch (e: any) {
      toast({ title: "Erro ao remover", description: e.message, variant: "destructive" });
    } finally {
      setBusyTrack(null);
    }
  }

  function openAddAt(position: number) {
    setAddPosition(position);
    setAddInput("");
    setAddOpen(true);
  }

  async function handleAddSubmit() {
    if (!addInput.trim()) return;
    setAdding(true);
    try {
      // 1) Enfileira add (bot adiciona no topo/fundo conforme implementação)
      const { data, error } = await supabase.functions.invoke("enqueue-playlist-job", {
        body: { playlist_id: playlistId, spotify_track_id: addInput.trim(), action: "add" },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      toast({
        title: "Faixa enfileirada",
        description: `Adicionada na posição ${addPosition} após o bot processar. Reordene depois se necessário.`,
      });
      setAddOpen(false);
      setAddInput("");
      loadJobs();
    } catch (e: any) {
      toast({ title: "Não consegui adicionar", description: e.message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        {/* Cabeçalho Spotify-style */}
        <div className="flex items-center gap-4">
          {meta.cover_url ? (
            <img
              src={meta.cover_url}
              alt=""
              className="h-20 w-20 rounded-md object-cover shrink-0 shadow-md"
            />
          ) : (
            <div className="h-20 w-20 rounded-md bg-muted shrink-0 grid place-items-center">
              <ListMusic className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Editor da playlist
            </div>
            <h2 className="text-2xl font-bold truncate text-foreground">
              {meta.name ?? "—"}
            </h2>
            <div className="text-sm text-muted-foreground mt-1">
              {loading
                ? "Carregando…"
                : `${tracks.length} ${tracks.length === 1 ? "faixa" : "faixas"} · ${fmtTotalDuration(totalDurationMs)}`}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { loadTracks(); loadJobs(); loadMeta(); }}
            disabled={loading}
            className="nx-pill"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            <span className="ml-1.5">Atualizar</span>
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Arraste pela alça para reordenar · Passe o mouse entre faixas para revelar o botão <Plus className="inline h-3 w-3" /> · Use a lixeira para remover.
          Ações entram numa fila e o badge mostra o estado.
        </p>


        {err && (
          <div className="flex items-start gap-2 text-sm text-destructive p-3 rounded-md border border-destructive/30 bg-destructive/5">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {loading ? (
          <div className="h-32 grid place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tracks.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            Nenhuma faixa nesta playlist.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={tracks.map((t) => t.spotify_track_id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-0.5">
                {tracks.map((t, i) => (
                  <SortableRow
                    key={t.spotify_track_id}
                    track={t}
                    position={i + 1}
                    pendingJob={pendingByTrack.get(t.spotify_track_id)}
                    onRemove={handleRemove}
                    onAddAt={openAddAt}
                    busy={busyTrack === t.spotify_track_id}
                  />
                ))}
                {/* + final pra adicionar no fim */}
                <li className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openAddAt(tracks.length + 1)}
                    className="w-full nx-pill border-dashed"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Adicionar no fim (posição {tracks.length + 1})
                  </Button>
                </li>
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </Card>

      {/* Dialog adicionar */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar faixa na posição {addPosition}</DialogTitle>
            <DialogDescription>
              Cole a URL do Spotify, URI (<code className="px-1 rounded bg-muted">spotify:track:…</code>) ou o ID de 22 caracteres.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder="https://open.spotify.com/track/…"
            disabled={adding}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddSubmit(); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={adding} className="nx-pill">
              Cancelar
            </Button>
            <Button onClick={handleAddSubmit} disabled={adding || !addInput.trim()} className="nx-pill">
              {adding ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
              Enfileirar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
