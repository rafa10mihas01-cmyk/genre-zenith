import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, ArrowLeft, Music, Info, RefreshCw, Search, Copy, X, ListPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";

type Step =
  | "idle" | "resolving" | "metadata" | "previewing" | "preview" | "distributing" | "done" | "error"
  | "batch";

const BATCH_MAX = 20;
const BATCH_DELAY_MS = 1200;

type BatchStatus = "pending" | "resolving" | "ready" | "sending" | "done" | "error";

type BatchItem = {
  key: string;
  raw: string;
  status: BatchStatus;
  trackId?: string;
  trackName?: string;
  artistName?: string;
  coverUrl?: string | null;
  genreId?: string;
  existing?: boolean;
  error?: string;
  resultMsg?: string;
};

/** Quebra a entrada em links/IDs únicos (máx. BATCH_MAX). */
function parseInputs(value: string): string[] {
  const parts = value
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= BATCH_MAX) break;
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Genre = { id: string; nome: string; slug: string };

type ResolveResult = {
  ok: boolean;
  error?: string;
  message?: string;
  track?: {
    spotify_track_id: string;
    spotify_uri: string;
    track_name: string;
    artist_name: string;
    isrc: string | null;
    cover_url: string | null;
    popularity: number | null;
    artist_followers: number | null;
  };
  spotify_genres_raw?: string[];
  detected?: {
    suggested_genre_id: string | null;
    suggested_genre_name: string | null;
    other_matches: Array<{ genre_id: string; genre_name: string }>;
    all_matches: Array<{ genre_id: string; genre_name: string }>;
  };
  existing?: {
    catalog_track_id: string;
    current_genre_id: string | null;
    current_genre_name: string | null;
    status: string;
    added_at: string;
  } | null;
};

type PreviewResult = {
  ok: boolean;
  error?: string;
  message?: string;
  track_exists?: boolean;
  genre_id?: string;
  genre_name?: string;
  pool_total?: number;
  distribution_count?: number;
  eligible_total?: number;
  already_present_count?: number;
};

type PlaylistHit = {
  id: string;
  name: string;
  spotify_playlist_id: string | null;
  followers: number | null;
  genre_id: string | null;
  already_present?: boolean;
};


type DistributeResult = {
  ok: boolean;
  error?: string;
  message?: string;
  track?: { is_new: boolean; genre_changed?: boolean };
  total_targets?: number;
  total_eligible_playlists?: number;
  skipped_already_present?: number;
  placements_created?: number;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDistributed?: () => void;
}

function fmtNum(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR");
}

export function AddCatalogTrackDialog({ open, onOpenChange, onDistributed }: Props) {
  const [step, setStep] = useState<Step>("idle");
  const [input, setInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [genres, setGenres] = useState<Genre[]>([]);
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const [selectedGenreId, setSelectedGenreId] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [distributed, setDistributed] = useState<DistributeResult | null>(null);

  // Carrega gêneros uma vez
  useEffect(() => {
    if (!open) return;
    supabase.from("genres").select("id, nome, slug").eq("ativo", true).order("nome")
      .then(({ data }) => setGenres((data ?? []) as Genre[]));
  }, [open]);

  const reset = () => {
    setStep("idle");
    setInput("");
    setErrorMsg(null);
    setResolved(null);
    setSelectedGenreId("");
    setPreview(null);
    setDistributed(null);
    setPlQuery("");
    setPlHits([]);
    setPlSelected([]);
    setPlSentIds([]);
    setBatchItems([]);
    setBatchRunning(false);
    setBatchTarget("genre");
    setBatchDone(false);
    batchStopRef.current = false;
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const selectedGenre = useMemo(
    () => genres.find((g) => g.id === selectedGenreId) ?? null,
    [genres, selectedGenreId],
  );

  const doResolve = async () => {
    const value = input.trim();
    if (!value) return;
    const tokens = parseInputs(value);
    if (tokens.length > 1) {
      void startBatch(tokens);
      return;
    }
    setStep("resolving");
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("resolve-catalog-track", {
        body: { input: value },
      });
      if (error) throw new Error(error.message);
      const r = data as ResolveResult;
      if (!r?.ok) throw new Error(r?.message ?? r?.error ?? "Falha ao resolver faixa");
      setResolved(r);
      // pré-seleciona: detected.suggested → existing.current → ""
      setSelectedGenreId(
        r.detected?.suggested_genre_id ?? r.existing?.current_genre_id ?? "",
      );
      setStep("metadata");
    } catch (e) {
      setErrorMsg((e as Error)?.message ?? String(e));
      setStep("error");
    }
  };

  const doPreview = async () => {
    if (!resolved?.track?.spotify_track_id || !selectedGenreId) return;
    setStep("previewing");
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("preview-distribute-catalog-track", {
        body: {
          spotify_track_id: resolved.track.spotify_track_id,
          genre_id: selectedGenreId,
        },
      });
      if (error) throw new Error(error.message);
      const r = data as PreviewResult;
      if (!r?.ok) throw new Error(r?.message ?? r?.error ?? "Falha no preview");
      setPreview(r);
      setStep("preview");
    } catch (e) {
      setErrorMsg((e as Error)?.message ?? String(e));
      setStep("error");
    }
  };

  const doDistribute = async () => {
    if (!resolved?.track?.spotify_track_id || !selectedGenreId) return;
    setStep("distributing");
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("distribute-catalog-track", {
        body: {
          input: resolved.track.spotify_track_id,
          genre_id: selectedGenreId,
        },
      });
      if (error) throw new Error(error.message);
      const r = data as DistributeResult;
      if (!r?.ok) throw new Error(r?.message ?? r?.error ?? "Falha na distribuição");
      setDistributed(r);
      setStep("done");
      onDistributed?.();
    } catch (e) {
      setErrorMsg((e as Error)?.message ?? String(e));
      setStep("error");
    }
  };

  // ———————————————————————————————————————————————
  // Envio direcionado a UMA playlist (permite 2ª cópia proposital)
  // ———————————————————————————————————————————————
  const [plQuery, setPlQuery] = useState("");
  const [plLoading, setPlLoading] = useState(false);
  const [plHits, setPlHits] = useState<PlaylistHit[]>([]);
  const [plSelected, setPlSelected] = useState<PlaylistHit[]>([]);
  const [plSending, setPlSending] = useState(false);
  const [plSentIds, setPlSentIds] = useState<string[]>([]);

  // ———————————————————————————————————————————————
  // Lote: até 20 links de uma vez, processados em fila
  // ———————————————————————————————————————————————
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchDone, setBatchDone] = useState(false);
  const [batchTarget, setBatchTarget] = useState<"genre" | "playlists">("genre");
  const batchStopRef = useRef(false);

  const togglePlaylist = (h: PlaylistHit) =>
    setPlSelected((prev) =>
      prev.some((p) => p.id === h.id) ? prev.filter((p) => p.id !== h.id) : [...prev, h],
    );

  useEffect(() => {
    if (step !== "preview" && !(step === "batch" && batchTarget === "playlists")) return;
    const q = plQuery.trim();
    let cancelled = false;
    setPlLoading(true);
    const timer = setTimeout(async () => {
      let query = supabase
        .from("managed_playlists")
        .select("id, name, spotify_playlist_id, followers, genre_id")
        .eq("execution_mode", "API_READY")
        .or("operational_status.is.null,operational_status.neq.do_not_operate");
      if (q.length >= 2) query = query.ilike("name", `%${q}%`);
      else if (selectedGenreId) query = query.eq("genre_id", selectedGenreId);
      const { data } = await query.order("followers", { ascending: false }).limit(q.length >= 2 ? 30 : 50);
      if (cancelled) return;
      const hits = (data ?? []) as PlaylistHit[];
      const trackSpotifyId = resolved?.track?.spotify_track_id;
      if (hits.length > 0 && trackSpotifyId) {
        const ids = hits.map((h) => h.id);
        const [{ data: mpt }, { data: cps }] = await Promise.all([
          supabase.from("managed_playlist_tracks")
            .select("playlist_id").in("playlist_id", ids).eq("spotify_track_id", trackSpotifyId),
          supabase.from("catalog_placements")
            .select("managed_playlist_id, catalog_tracks!inner(spotify_track_id)")
            .in("managed_playlist_id", ids).neq("status", "removed")
            .eq("catalog_tracks.spotify_track_id", trackSpotifyId),
        ]);
        const present = new Set<string>([
          ...((mpt ?? []) as Array<{ playlist_id: string }>).map((r) => r.playlist_id),
          ...((cps ?? []) as Array<{ managed_playlist_id: string }>).map((r) => r.managed_playlist_id),
        ]);
        for (const h of hits) h.already_present = present.has(h.id);
      }
      if (!cancelled) { setPlHits(hits); setPlLoading(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); setPlLoading(false); };
  }, [plQuery, step, resolved?.track?.spotify_track_id, selectedGenreId, batchTarget]);

  const doPlaceOnPlaylist = async () => {
    if (plSelected.length === 0 || !resolved?.track?.spotify_track_id) return;
    setPlSending(true);
    const okIds: string[] = [];
    const fails: string[] = [];
    const map: Record<string, string> = {
      track_not_in_catalog: "Cadastre a música no catálogo primeiro (botão de distribuir).",
      playlist_not_operable: "playlist não operável",
      max_copies_reached: "já tem as 2 cópias permitidas",
      placement_conflict: "já existe envio pendente",
    };
    for (const pl of plSelected) {
      try {
        const { data, error } = await supabase.functions.invoke("place-catalog-track-on-playlist", {
          body: {
            spotify_track_id: resolved.track.spotify_track_id,
            managed_playlist_id: pl.id,
            allow_duplicate: true,
            genre_id: selectedGenreId || null,
            track_meta: {
              track_name: resolved.track.track_name,
              artist_name: resolved.track.artist_name,
              spotify_uri: resolved.track.spotify_uri,
              isrc: resolved.track.isrc,
              cover_url: resolved.track.cover_url,
            },
          },
        });
        if (error) throw new Error(error.message);
        const r = data as { ok: boolean; error?: string; message?: string };
        if (!r?.ok) throw new Error(map[r?.error ?? ""] ?? r?.message ?? r?.error ?? "falha");
        okIds.push(pl.id);
      } catch (e) {
        fails.push(`${pl.name}: ${(e as Error)?.message ?? "falha"}`);
      }
    }
    setPlSentIds((prev) => [...prev, ...okIds]);
    setPlSelected([]);
    setPlSending(false);
    if (okIds.length > 0) {
      toast.success(
        okIds.length === 1 ? "Música agendada em 1 playlist" : `Música agendada em ${okIds.length} playlists`,
      );
      onDistributed?.();
    }
    if (fails.length > 0) {
      toast.error(`${fails.length} não ${fails.length === 1 ? "entrou" : "entraram"}`, {
        description: fails.slice(0, 4).join(" · "),
      });
    }
  };

  // ———————————————————————————————————————————————
  // Lote — identificação (fila) e execução (fila)
  // ———————————————————————————————————————————————
  const patchItem = (key: string, patch: Partial<BatchItem>) =>
    setBatchItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const startBatch = async (tokens: string[]) => {
    const items: BatchItem[] = tokens.map((raw, i) => ({
      key: `${i}-${raw}`,
      raw,
      status: "pending",
    }));
    setBatchItems(items);
    setBatchDone(false);
    setErrorMsg(null);
    setStep("batch");

    for (const it of items) {
      patchItem(it.key, { status: "resolving" });
      try {
        const { data, error } = await supabase.functions.invoke("resolve-catalog-track", {
          body: { input: it.raw },
        });
        if (error) throw new Error(error.message);
        const r = data as ResolveResult;
        if (!r?.ok || !r.track) throw new Error(r?.message ?? r?.error ?? "Falha ao resolver faixa");
        patchItem(it.key, {
          status: "ready",
          trackId: r.track.spotify_track_id,
          trackName: r.track.track_name,
          artistName: r.track.artist_name,
          coverUrl: r.track.cover_url,
          existing: !!r.existing,
          genreId: r.detected?.suggested_genre_id ?? r.existing?.current_genre_id ?? undefined,
        });
      } catch (e) {
        patchItem(it.key, { status: "error", error: (e as Error)?.message ?? "Falha ao identificar" });
      }
      await sleep(600);
    }
  };

  const applyGenreToAll = (genreId: string) =>
    setBatchItems((prev) =>
      prev.map((it) => (it.status === "ready" || it.status === "done" ? { ...it, genreId } : it)),
    );

  const removeBatchItem = (key: string) =>
    setBatchItems((prev) => prev.filter((it) => it.key !== key));

  const runBatch = async (onlyFailed = false) => {
    const queue = batchItems.filter(
      (it) =>
        it.trackId &&
        it.genreId &&
        (onlyFailed ? it.status === "error" : it.status === "ready" || it.status === "error"),
    );
    if (queue.length === 0) return;
    if (batchTarget === "playlists" && plSelected.length === 0) {
      toast.error("Escolha ao menos uma playlist");
      return;
    }
    batchStopRef.current = false;
    setBatchRunning(true);
    setBatchDone(false);

    for (const it of queue) {
      if (batchStopRef.current) break;
      patchItem(it.key, { status: "sending", error: undefined, resultMsg: undefined });
      try {
        if (batchTarget === "genre") {
          const { data, error } = await supabase.functions.invoke("distribute-catalog-track", {
            body: { input: it.trackId, genre_id: it.genreId },
          });
          if (error) throw new Error(error.message);
          const r = data as DistributeResult;
          if (!r?.ok) throw new Error(r?.message ?? r?.error ?? "Falha na distribuição");
          patchItem(it.key, {
            status: "done",
            resultMsg: `${r.placements_created ?? 0} pendências criadas`,
          });
        } else {
          let ok = 0;
          const fails: string[] = [];
          for (const pl of plSelected) {
            const { data, error } = await supabase.functions.invoke("place-catalog-track-on-playlist", {
              body: {
                spotify_track_id: it.trackId,
                managed_playlist_id: pl.id,
                allow_duplicate: true,
                genre_id: it.genreId ?? null,
                track_meta: {
                  track_name: it.trackName,
                  artist_name: it.artistName,
                  spotify_uri: `spotify:track:${it.trackId}`,
                  isrc: null,
                  cover_url: it.coverUrl ?? null,
                },
              },
            });
            const r = data as { ok?: boolean; error?: string; message?: string } | null;
            if (error || !r?.ok) {
              fails.push(pl.name);
            } else {
              ok++;
            }
            await sleep(400);
          }
          if (ok === 0) throw new Error(`nenhuma playlist aceitou (${fails.slice(0, 3).join(", ")})`);
          patchItem(it.key, {
            status: "done",
            resultMsg: `${ok} playlist${ok === 1 ? "" : "s"}${fails.length ? ` · ${fails.length} falhou` : ""}`,
          });
        }
      } catch (e) {
        patchItem(it.key, { status: "error", error: (e as Error)?.message ?? "falha" });
      }
      await sleep(BATCH_DELAY_MS);
    }

    setBatchRunning(false);
    setBatchDone(true);
    onDistributed?.();
  };



  // —————————————————————————————————————————————————————————
  // Render auxiliares
  // —————————————————————————————————————————————————————————

  const renderTrackCard = (compact = false) => {
    if (!resolved?.track) return null;
    const t = resolved.track;
    return (
      <div className="flex gap-3 rounded-lg border border-border/60 bg-muted/30 p-3 min-w-0">
        {t.cover_url ? (
          <img
            src={t.cover_url}
            alt={t.track_name}
            className={compact ? "h-10 w-10 rounded-md shrink-0 object-cover ring-1 ring-border" : "h-16 w-16 rounded-md shrink-0 object-cover ring-1 ring-border"}
          />
        ) : (
          <div className={compact ? "h-10 w-10 rounded-md shrink-0 bg-muted flex items-center justify-center" : "h-16 w-16 rounded-md shrink-0 bg-muted flex items-center justify-center"}>
            <Music className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="text-[13px] font-semibold leading-tight truncate">{t.track_name}</div>
          <div className="text-[11px] text-muted-foreground truncate">{t.artist_name}</div>
          {!compact && (
            <div className="text-[10px] text-muted-foreground font-mono pt-1 space-x-2 truncate">
              {t.isrc && <span>ISRC: {t.isrc}</span>}
              <span>ID: {t.spotify_track_id}</span>
            </div>
          )}
          {compact && selectedGenre && (
            <Badge variant="secondary" className="text-[10px] mt-1 capitalize h-4 px-1.5 py-0">{selectedGenre.nome}</Badge>
          )}
        </div>
      </div>
    );
  };

  const renderStepIdleOrResolving = () => (
    <div className="space-y-2">
      <Label htmlFor="track-input" className="text-[12px]">Spotify URL, URI ou ID (faixa ou álbum)</Label>
      <Input
        id="track-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="https://open.spotify.com/track/... ou /album/..."

        autoFocus
        autoComplete="off"
        spellCheck={false}
        disabled={step === "resolving"}
        onKeyDown={(e) => {
          if (e.key === "Enter" && step === "idle" && input.trim()) doResolve();
        }}
      />
    </div>
  );


  const renderStepMetadata = () => {
    if (!resolved) return null;
    const detected = resolved.detected;
    const existing = resolved.existing;
    const others = detected?.other_matches ?? [];
    return (
      <div className="space-y-3 min-w-0">
        {renderTrackCard(false)}

        {existing && (
          <div className="flex items-start gap-2 p-3 nx-subcard border-amber-500/30 text-[12px]">
            <Info className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium leading-tight">Esta música já está cadastrada.</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Gênero atual: <span className="capitalize font-medium">{existing.current_genre_name ?? "(não definido)"}</span>.
                Será atualizado se você escolher outro. Placements existentes serão preservados.
              </div>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-[12px]">Gênero da música</Label>
          <Select value={selectedGenreId} onValueChange={setSelectedGenreId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o gênero" />
            </SelectTrigger>
            <SelectContent>
              {genres.map((g) => (
                <SelectItem key={g.id} value={g.id} className="capitalize">{g.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {detected?.suggested_genre_name ? (
            <div className="text-[11px] text-muted-foreground space-y-1 pt-1">
              <div>
                Detectado pelo Spotify: <span className="font-medium capitalize text-foreground">{detected.suggested_genre_name}</span>
              </div>
              {others.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  <span>Outras opções:</span>
                  {others.map((o) => (
                    <button
                      key={o.genre_id}
                      type="button"
                      onClick={() => setSelectedGenreId(o.genre_id)}
                      className="px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 capitalize text-[10px]"
                    >
                      {o.genre_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground pt-1">
              Nenhum gênero detectado automaticamente
              {resolved.spotify_genres_raw?.length ? (
                <> (Spotify retornou: {resolved.spotify_genres_raw.join(", ")})</>
              ) : null}. Escolha manualmente.
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderTargetedSend = () => {
    const dupCount = plSelected.filter((p) => p.already_present).length;
    return (
    <div className="space-y-2.5 rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="space-y-0.5">
        <div className="text-[12px] font-medium">Escolher playlists específicas</div>
        <div className="text-[11px] text-muted-foreground">
          Marque quantas quiser na lista abaixo (ou busque pelo nome). Playlists que já têm a música também aparecem — nelas o envio cria uma segunda entrada proposital.
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={plQuery}
          onChange={(e) => setPlQuery(e.target.value)}
          placeholder="Buscar playlist pelo nome…"
          className="pl-8 h-9"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="max-h-52 overflow-y-auto space-y-1 pr-1 -mr-1">
        {plLoading && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Buscando…
          </div>
        )}
        {!plLoading && plHits.length === 0 && (
          <div className="text-[11px] text-muted-foreground py-2">Nenhuma playlist operável encontrada.</div>
        )}
        {plHits.map((h) => {
          const isSel = plSelected.some((p) => p.id === h.id);
          const sent = plSentIds.includes(h.id);
          return (
            <button
              key={h.id}
              type="button"
              onClick={() => togglePlaylist(h)}
              className={`w-full text-left px-2.5 py-2 rounded-md border transition-colors ${
                isSel ? "border-primary/50 bg-primary/5" : "border-border/60 hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`h-3.5 w-3.5 rounded-[4px] border shrink-0 flex items-center justify-center ${
                    isSel ? "bg-primary border-primary" : "border-border"
                  }`}
                >
                  {isSel && <CheckCircle2 className="h-3 w-3 text-primary-foreground" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium truncate">{h.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {fmtNum(h.followers)} seguidores
                  </div>
                </div>
                {sent && (
                  <Badge variant="secondary" className="text-[9px] h-4 px-1.5 shrink-0">enviada</Badge>
                )}
                {h.already_present && !sent && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5 shrink-0 border-amber-500/40 text-amber-500">
                    já contém
                  </Badge>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {plSelected.length > 0 && (
        <div className="space-y-2 pt-1">
          {dupCount > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px]">
              <Copy className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
              <span>
                {dupCount} das selecionadas já {dupCount === 1 ? "tem" : "têm"} essa música. Confirmar cria uma{" "}
                <span className="font-medium">segunda entrada</span> {dupCount === 1 ? "nela" : "nelas"}.
              </span>
            </div>
          )}
          <Button size="sm" onClick={doPlaceOnPlaylist} disabled={plSending} className="gap-2 w-full">
            {plSending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {plSelected.length === 1
              ? "Enviar só para esta playlist"
              : `Enviar para ${plSelected.length} playlists selecionadas`}
          </Button>
        </div>
      )}
    </div>
    );
  };


  const renderStepPreview = () => {
    if (!preview || !resolved) return null;
    const poolTotal = preview.pool_total ?? 0;
    const distributionCount = preview.distribution_count ?? preview.eligible_total ?? 0;
    const presentCount = preview.already_present_count ?? 0;
    const genreName = preview.genre_name ?? "—";

    return (
      <div className="space-y-4 min-w-0">
        {renderTrackCard(true)}

        {preview.track_exists && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-[12px]">
            <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Música já está cadastrada.</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Apenas placements novos serão criados. Nada será duplicado.
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="p-3 rounded-lg bg-muted/30 border border-border/60 min-w-0">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider leading-tight">Total de playlists do gênero</div>
            <div className="text-xl font-semibold tabular-nums leading-none mt-1">{fmtNum(poolTotal)}</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border border-border/60 min-w-0">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider leading-tight">Já possuem</div>
            <div className="text-xl font-semibold tabular-nums leading-none mt-1">{fmtNum(presentCount)}</div>
          </div>
          <div className="p-3 rounded-lg bg-primary/5 border border-primary/30 min-w-0">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider leading-tight">Faltam distribuir</div>
            <div className="text-xl font-semibold tabular-nums text-primary leading-none mt-1">{fmtNum(distributionCount)}</div>
          </div>
        </div>

        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Existem <span className="text-foreground font-medium">{fmtNum(poolTotal)}</span> playlists de <span className="capitalize text-foreground font-medium">{genreName}</span> no ecossistema. <span className="text-foreground font-medium">{fmtNum(presentCount)}</span> já {presentCount === 1 ? "possui" : "possuem"} esta música; faltam distribuir para <span className="text-foreground font-medium">{fmtNum(distributionCount)}</span>.
        </p>

        {distributionCount === 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium">Nada a distribuir em <span className="capitalize">{genreName}</span>.</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {poolTotal === 0
                  ? "Esse gênero não tem playlists cadastradas no ecossistema."
                  : "Todas as playlists do gênero já possuem esta música."}
              </div>
            </div>
          </div>
        )}

        {renderTargetedSend()}
      </div>
    );
  };


  const renderStepDone = () => {
    if (!distributed) return null;
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/10 border border-primary/30">
          <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="space-y-1 min-w-0">
            <div className="font-semibold">Distribuição concluída</div>
            <div className="text-xs text-muted-foreground">
              {distributed.track?.is_new
                ? "Música nova cadastrada."
                : distributed.track?.genre_changed
                  ? "Música já existia — gênero atualizado e expansão executada."
                  : "Música já existia — expansão para playlists novas."}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 text-sm">
          <div className="p-3 rounded-lg bg-primary/10 border border-primary/30">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Pendências criadas</div>
            <div className="text-2xl font-semibold tabular-nums text-primary">{distributed.placements_created ?? 0}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderStepError = () => (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/30">
      <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
      <div className="space-y-1 min-w-0">
        <div className="font-semibold text-destructive">Erro</div>
        <div className="text-sm text-muted-foreground break-words">{errorMsg ?? "Falha desconhecida"}</div>
      </div>
    </div>
  );

  // —————————————————————————————————————————————————————————
  // Header + footer dinâmicos
  // —————————————————————————————————————————————————————————

  const title =
    step === "preview" || step === "previewing" || step === "distributing" ? "Confirmar distribuição" :
    step === "done" ? "Distribuição concluída" :
    step === "error" ? "Erro" :
    "Adicionar música";

  const description =
    step === "idle" || step === "resolving"
      ? "Cole a URL do Spotify para buscar a faixa."
      : step === "metadata"
        ? "Confirme o gênero antes do preview."
        : step === "preview" || step === "previewing" || step === "distributing"
          ? "Revise o impacto antes de criar os placements."
          : undefined;


  const isBusy = step === "resolving" || step === "previewing" || step === "distributing";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6 gap-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <Card className="border-border/60 bg-card overflow-hidden">
          <CardContent className="p-4 sm:p-5 space-y-4 min-w-0">
            {(step === "idle" || step === "resolving") && renderStepIdleOrResolving()}
            {step === "metadata" && renderStepMetadata()}
            {(step === "previewing" || step === "preview" || step === "distributing") && (
              step === "previewing"
                ? <div className="py-8 flex items-center justify-center text-sm text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Calculando preview…</div>
                : renderStepPreview()
            )}
            {step === "done" && renderStepDone()}
            {step === "error" && renderStepError()}

        <DialogFooter className="gap-2 sm:gap-2 pt-2">
          {step === "idle" || step === "resolving" ? (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={isBusy}>Cancelar</Button>
              <Button onClick={doResolve} disabled={isBusy || !input.trim()} className="gap-2">
                {step === "resolving" && <Loader2 className="h-4 w-4 animate-spin" />}
                {step === "resolving" ? "Buscando…" : "Buscar"}
              </Button>
            </>
          ) : step === "metadata" ? (
            <>
              <Button variant="outline" onClick={reset} className="gap-2"><ArrowLeft className="h-4 w-4" /> Voltar</Button>
              <Button onClick={doPreview} disabled={!selectedGenreId}>Ver preview</Button>
            </>
          ) : step === "previewing" || step === "preview" || step === "distributing" ? (
            <>
              <Button variant="outline" onClick={() => setStep("metadata")} disabled={isBusy} className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Voltar
              </Button>
              <Button
                onClick={doDistribute}
                disabled={isBusy}
                className="gap-2"
              >
                {step === "distributing" && <Loader2 className="h-4 w-4 animate-spin" />}
                {step === "distributing"
                  ? "Distribuindo…"
          : `Distribuir para ${preview?.distribution_count ?? preview?.eligible_total ?? 0} ${(preview?.distribution_count ?? preview?.eligible_total ?? 0) === 1 ? "playlist" : "playlists"}`}
              </Button>
            </>
          ) : step === "done" ? (
            <>
              <Button variant="outline" onClick={() => handleClose(false)}>Fechar</Button>
              <Button onClick={reset} className="gap-2"><RefreshCw className="h-4 w-4" /> Adicionar outra</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={reset}>Recomeçar</Button>
              <Button onClick={() => handleClose(false)}>Fechar</Button>
            </>
          )}
        </DialogFooter>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
