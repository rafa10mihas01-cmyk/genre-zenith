// PlaylistEditorTab — editor visual da playlist com posições numeradas (1-indexadas),
// drag-and-drop pra reordenar (dnd-kit/sortable), botão + por posição pra adicionar
// faixa naquela posição, lixeira por linha pra remover, badge "pendente" por linha
// quando há job na fila pra aquela faixa.
//
// Proteções operacionais:
//  - Lock: respeita managed_playlists.locked_at (banner + desabilita ações se < 30s).
//  - Batching: drags consecutivos são acumulados por 1.5s e enviados como 1 job
//    com o movimento líquido (from inicial → to final da última faixa tocada).
//  - inFlight forte: enquanto houver job pending/claimed na fila desta playlist,
//    todos os botões ficam desabilitados; libera automaticamente via realtime.
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
  Loader2, Trash2, Plus, RefreshCw, GripVertical, ListMusic, AlertCircle, Clock, Lock,
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
  job_type: "playlist.track.add" | "playlist.track.remove" | "playlist.track.reorder";
  spotify_track_id: string;
  status: "pending" | "claimed" | "done" | "failed" | "cancelled";
  from_position: number | null;
  to_position: number | null;
};

const LOCK_WINDOW_MS = 30_000;     // lock considerado ativo se locked_at > now()-30s
const LOCK_REVALIDATE_MS = 5_000;  // revalida lock a cada 5s
const REORDER_DEBOUNCE_MS = 1_500; // acumula drags por 1.5s

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
  locked_at: string | null;
  locked_by: string | null;
};

function SortableRow({
  track, position, pendingJob, onRemove, onAddAt, busy, disabled,
}: {
  track: Track;
  position: number;
  pendingJob?: Job;
  onRemove: (id: string) => void;
  onAddAt: (position: number) => void;
  busy: boolean;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: track.spotify_track_id, disabled });

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
        disabled={disabled}
        className="absolute -top-1.5 left-1/2 -translate-x-1/2 z-20 h-5 w-5 rounded-full bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground border border-primary/30 opacity-0 group-hover/row:opacity-100 transition-opacity grid place-items-center disabled:cursor-not-allowed disabled:opacity-0"
        title={`Adicionar na posição ${position}`}
      >
        <Plus className="h-3 w-3" />
      </button>

      <div className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-muted/40 transition-colors">
        {/* Posição / drag handle no hover */}
        <div className="w-8 shrink-0 grid place-items-center">
          <span className={cn(
            "tabular-nums text-sm text-muted-foreground",
            !disabled && "group-hover/row:hidden",
          )}>
            {position}
          </span>
          {!disabled && (
            <button
              type="button"
              {...attributes}
              {...listeners}
              className="hidden group-hover/row:grid place-items-center cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
              aria-label="Arrastar"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
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
          disabled={busy || disabled || !!pendingJob}
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
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [busyTrack, setBusyTrack] = useState<string | null>(null);
  const [meta, setMeta] = useState<PlaylistMeta>({
    name: null, cover_url: null, locked_at: null, locked_by: null,
  });
  const [source, setSource] = useState<"spotify" | "cache" | null>(null);
  const [cacheSnapshotAt, setCacheSnapshotAt] = useState<string | null>(null);
  const [lockTick, setLockTick] = useState<number>(() => Date.now());

  // Dialog "Adicionar na posição X"
  const [addOpen, setAddOpen] = useState(false);
  const [addPosition, setAddPosition] = useState<number>(1);
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);

  // Trava cliques duplos sub-200ms — antes do estado React propagar pro disabled
  const inFlight = useRef(false);

  // Debounce de 2s no botão Atualizar pra não derrubar limites do Spotify
  const lastRefreshAt = useRef<number>(0);
  const REFRESH_COOLDOWN_MS = 2000;

  // Batching de reorders — guarda o id da faixa movida e a posição original
  // ANTES do primeiro drag do batch (pra calcular o movimento líquido).
  const reorderBatch = useRef<{
    trackId: string;
    fromPosition: number; // posição 1-indexada original (antes do 1º drag)
  } | null>(null);
  const reorderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ===== Lock operacional =====
  const isLocked = useMemo(() => {
    if (!meta.locked_at) return false;
    const lockedMs = new Date(meta.locked_at).getTime();
    return Number.isFinite(lockedMs) && lockedMs > lockTick - LOCK_WINDOW_MS;
  }, [meta.locked_at, lockTick]);

  // ===== Jobs ativos da playlist =====
  const hasActiveJobs = useMemo(
    () => jobs.some((j) => j.status === "pending" || j.status === "claimed"),
    [jobs],
  );

  // ===== Busy global (qualquer ação fica bloqueada) =====
  const isBusy = isLocked || hasActiveJobs;

  // Revalida lock a cada 5s (recarrega meta + reavalia tick)
  useEffect(() => {
    const id = setInterval(() => {
      setLockTick(Date.now());
      loadMeta();
    }, LOCK_REVALIDATE_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  // Tick por segundo enquanto houver countdown ativo
  useEffect(() => {
    if (!rateLimitUntil) return;
    const id = setInterval(() => {
      const now = Date.now();
      setNowTick(now);
      if (now >= rateLimitUntil) {
        clearInterval(id);
        setRateLimitUntil(null);
        loadTracks();
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateLimitUntil]);

  const rateLimitSecLeft = rateLimitUntil
    ? Math.max(0, Math.ceil((rateLimitUntil - nowTick) / 1000))
    : 0;

  function handleRefreshClick() {
    const now = Date.now();
    if (rateLimitUntil && now < rateLimitUntil) return;
    if (now - lastRefreshAt.current < REFRESH_COOLDOWN_MS) return;
    lastRefreshAt.current = now;
    loadTracks();
    loadJobs();
    loadMeta();
  }

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
          const retrySec = Number(data?.retry_after) || 15;
          setRateLimitUntil(Date.now() + retrySec * 1000);
          setErr(null);
          setTracks([]);
          return;
        }
        throw new Error(data?.error ?? "Falhou");
      }
      const isCache = data.source === "cache";
      setRateLimitUntil(null);
      setSource(isCache ? "cache" : "spotify");
      setCacheSnapshotAt(isCache ? (data.cache_snapshot_at ?? null) : null);
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
      .select("name, cover_url, locked_at, locked_by")
      .eq("id", playlistId)
      .maybeSingle();
    if (data) {
      setMeta({
        name: data.name ?? null,
        cover_url: (data as any).cover_url ?? null,
        locked_at: (data as any).locked_at ?? null,
        locked_by: (data as any).locked_by ?? null,
      });
    }
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
            loadTracks();
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      // Cancela timer pendente ao desmontar
      if (reorderTimer.current) {
        clearTimeout(reorderTimer.current);
        reorderTimer.current = null;
        reorderBatch.current = null;
      }
    };
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

  // ===== Dispara o job de reorder consolidado (chamado pelo debounce) =====
  async function flushReorderBatch() {
    const batch = reorderBatch.current;
    reorderBatch.current = null;
    reorderTimer.current = null;
    if (!batch) return;

    // Posição final da faixa no estado atual (1-indexado)
    const finalIdx = tracks.findIndex((t) => t.spotify_track_id === batch.trackId);
    if (finalIdx === -1) return;
    const toPosition = finalIdx + 1;
    if (toPosition === batch.fromPosition) return; // movimento líquido = 0

    inFlight.current = true;
    setBusyTrack(batch.trackId);
    try {
      const { data, error } = await supabase.functions.invoke("enqueue-playlist-job", {
        body: {
          playlist_id: playlistId,
          spotify_track_id: batch.trackId,
          action: "reorder",
          from_position: batch.fromPosition,
          to_position: toPosition,
        },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      toast({
        title: "Reordenação enfileirada",
        description: `Posição ${batch.fromPosition} → ${toPosition}.`,
      });
      loadJobs();
    } catch (e: unknown) {
      toast({ title: "Não consegui reordenar", description: getErrorMessage(e), variant: "destructive" });
      loadTracks(); // rollback via refetch
    } finally {
      setBusyTrack(null);
      inFlight.current = false;
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (isBusy || inFlight.current) return;

    const trackId = String(active.id);
    const oldIndex = tracks.findIndex((t) => t.spotify_track_id === trackId);
    const newIndex = tracks.findIndex((t) => t.spotify_track_id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Otimista: reordena localmente
    setTracks((prev) => arrayMove(prev, oldIndex, newIndex));

    // Inicia ou estende o batch:
    //  - Se já existe batch da mesma faixa, mantém fromPosition original.
    //  - Se é faixa diferente, dá flush no batch anterior antes (caso especial raro).
    if (reorderBatch.current && reorderBatch.current.trackId !== trackId) {
      // Faixa diferente: cancela timer anterior e dispara agora (síncrono via setTimeout 0)
      if (reorderTimer.current) clearTimeout(reorderTimer.current);
      const prev = reorderBatch.current;
      reorderBatch.current = null;
      reorderTimer.current = null;
      // Reabre batch com a posição final atual da faixa anterior
      const prevIdx = tracks.findIndex((t) => t.spotify_track_id === prev.trackId);
      if (prevIdx !== -1 && prevIdx + 1 !== prev.fromPosition) {
        // Dispara o anterior imediatamente
        reorderBatch.current = prev;
        await flushReorderBatch();
      }
    }

    if (!reorderBatch.current) {
      reorderBatch.current = {
        trackId,
        fromPosition: oldIndex + 1, // posição ORIGINAL antes do 1º drag
      };
    }

    // Reset do timer — cada drag adia o flush em 1.5s
    if (reorderTimer.current) clearTimeout(reorderTimer.current);
    reorderTimer.current = setTimeout(flushReorderBatch, REORDER_DEBOUNCE_MS);
  }

  async function handleRemove(spotify_track_id: string) {
    if (isBusy || inFlight.current) return;
    inFlight.current = true;
    setBusyTrack(spotify_track_id);
    try {
      const { data, error } = await supabase.functions.invoke("enqueue-playlist-job", {
        body: { playlist_id: playlistId, spotify_track_id, action: "remove" },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      toast({ title: "Remoção enfileirada", description: "Bot vai processar em instantes." });
      loadJobs();
    } catch (e: unknown) {
      toast({ title: "Erro ao remover", description: getErrorMessage(e), variant: "destructive" });
    } finally {
      setBusyTrack(null);
      inFlight.current = false;
    }
  }

  function openAddAt(position: number) {
    if (isBusy) return;
    setAddPosition(position);
    setAddInput("");
    setAddOpen(true);
  }

  async function handleAddSubmit() {
    if (!addInput.trim()) return;
    if (isBusy || inFlight.current) return;
    inFlight.current = true;
    setAdding(true);
    try {
      const positionToSend =
        Number.isInteger(addPosition) && addPosition >= 1 ? addPosition : null;
      const { data, error } = await supabase.functions.invoke("enqueue-playlist-job", {
        body: {
          playlist_id: playlistId,
          spotify_track_id: addInput.trim(),
          action: "add",
          ...(positionToSend ? { to_position: positionToSend } : {}),
        },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      const confirmedPos =
        Number.isInteger(data?.job?.to_position) && data.job.to_position >= 1
          ? data.job.to_position
          : null;
      toast({
        title: data?.deduped ? "Já estava na fila" : "Faixa enfileirada",
        description: confirmedPos
          ? `Bot vai inserir na posição ${confirmedPos}.`
          : "Bot vai inserir no fim da playlist.",
      });
      setAddOpen(false);
      setAddInput("");
      loadJobs();
    } catch (e: unknown) {
      toast({ title: "Não consegui adicionar", description: getErrorMessage(e), variant: "destructive" });
    } finally {
      setAdding(false);
      inFlight.current = false;
    }
  }

  // Quantos jobs ativos pra mensagem de status
  const activeJobsCount = useMemo(
    () => jobs.filter((j) => j.status === "pending" || j.status === "claimed").length,
    [jobs],
  );

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        {/* Cabeçalho */}
        <div className="flex items-center gap-4">
          {meta.cover_url ? (
            <img src={meta.cover_url} alt="" className="h-20 w-20 rounded-md object-cover shrink-0 shadow-md" />
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
            onClick={handleRefreshClick}
            disabled={loading || rateLimitSecLeft > 0}
            className="nx-pill"
            title={rateLimitSecLeft > 0 ? `Aguarde ${rateLimitSecLeft}s` : "Atualizar"}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            <span className="ml-1.5">
              {rateLimitSecLeft > 0 ? `Aguarde ${rateLimitSecLeft}s` : "Atualizar"}
            </span>
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Arraste pela alça para reordenar · Passe o mouse entre faixas para revelar o botão <Plus className="inline h-3 w-3" /> · Use a lixeira para remover.
          Reordenações consecutivas são agrupadas e enviadas após 1,5s.
        </p>

        {/* Banner: lock operacional */}
        {isLocked && (
          <div className="flex items-start gap-2 text-sm p-3 rounded-md border border-warning/40 bg-warning/5 text-warning">
            <Lock className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Playlist sendo sincronizada — aguarde…</span>
          </div>
        )}

        {/* Banner: jobs ativos na fila */}
        {!isLocked && hasActiveJobs && (
          <div className="flex items-start gap-2 text-sm p-3 rounded-md border border-warning/40 bg-warning/5 text-warning">
            <Clock className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              {activeJobsCount} {activeJobsCount === 1 ? "ação" : "ações"} na fila — aguardando o bot processar antes de permitir novas edições.
            </span>
          </div>
        )}

        {rateLimitSecLeft > 0 && (
          <div className="flex items-start gap-2 text-sm p-3 rounded-md border border-warning/40 bg-warning/5 text-warning">
            <Clock className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Aguardando liberação do Spotify — tentando novamente em <span className="tabular-nums font-semibold">{rateLimitSecLeft}s</span>
            </span>
          </div>
        )}

        {source === "cache" && (
          <div className="flex items-start gap-2 text-sm p-3 rounded-md border border-warning/40 bg-warning/5 text-warning">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Mostrando faixas salvas{cacheSnapshotAt ? ` (snapshot de ${new Date(cacheSnapshotAt).toLocaleString("pt-BR")})` : ""} — Spotify temporariamente indisponível.
            </span>
          </div>
        )}

        {err && rateLimitSecLeft === 0 && (
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
              <ul className={cn("space-y-0.5", isBusy && "opacity-60 pointer-events-none")}>
                {tracks.map((t, i) => (
                  <SortableRow
                    key={t.spotify_track_id}
                    track={t}
                    position={i + 1}
                    pendingJob={pendingByTrack.get(t.spotify_track_id)}
                    onRemove={handleRemove}
                    onAddAt={openAddAt}
                    busy={busyTrack === t.spotify_track_id}
                    disabled={isBusy}
                  />
                ))}
                {/* + final pra adicionar no fim */}
                <li className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openAddAt(tracks.length + 1)}
                    disabled={isBusy}
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
