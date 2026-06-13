// AddCatalogTrackDialog — fluxo URL → Buscar → Confirmar → Preview → Distribuir.
//
// Etapa 1 (metadata): cola URL, busca via `resolve-catalog-track`, mostra capa/nome/
// artista/ISRC + select de gênero (pré-selecionado com a detecção, editável).
// Etapa 2 (preview): chama `preview-distribute-catalog-track` e mostra playlists
// compatíveis, já presentes, sem capacidade, e capacidade total do gênero.
// Botão final invoca `distribute-catalog-track` com o genre_id confirmado.
import { useEffect, useMemo, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, ArrowLeft, Music, Info, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

type Step = "idle" | "resolving" | "metadata" | "previewing" | "preview" | "distributing" | "done" | "error";

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

type PreviewPlaylist = {
  id: string;
  name: string;
  cover_url: string | null;
  followers: number | null;
  available_slots?: number;
  tracks_count?: number;
  projected_position?: number;
};

type PreviewResult = {
  ok: boolean;
  error?: string;
  message?: string;
  track_exists?: boolean;
  genre_id?: string;
  genre_name?: string;
  genre_pool_total?: number;
  genre_capacity_total?: number;
  genre_capacity_used?: number;
  genre_capacity_free?: number;
  eligible?: PreviewPlaylist[];
  already_present?: PreviewPlaylist[];
  no_capacity?: PreviewPlaylist[];
  eligible_count?: number;
  already_present_count?: number;
  no_capacity_count?: number;
};

type DistributeResult = {
  ok: boolean;
  error?: string;
  message?: string;
  track?: { is_new: boolean; genre_changed?: boolean };
  total_eligible_playlists?: number;
  skipped_already_present?: number;
  skipped_no_capacity?: number;
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

  // —————————————————————————————————————————————————————————
  // Render auxiliares
  // —————————————————————————————————————————————————————————

  const renderTrackCard = (compact = false) => {
    if (!resolved?.track) return null;
    const t = resolved.track;
    return (
      <div className="flex gap-3 p-3 rounded-xl bg-muted/30 border border-border">
        {t.cover_url ? (
          <img
            src={t.cover_url}
            alt={t.track_name}
            className={compact ? "h-12 w-12 rounded shrink-0 object-cover" : "h-20 w-20 rounded-lg shrink-0 object-cover"}
          />
        ) : (
          <div className={compact ? "h-12 w-12 rounded shrink-0 bg-muted flex items-center justify-center" : "h-20 w-20 rounded-lg shrink-0 bg-muted flex items-center justify-center"}>
            <Music className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="font-semibold truncate">{t.track_name}</div>
          <div className="text-sm text-muted-foreground truncate">{t.artist_name}</div>
          {!compact && (
            <div className="text-xs text-muted-foreground font-mono pt-1 space-x-2">
              {t.isrc && <span>ISRC: {t.isrc}</span>}
              <span>ID: {t.spotify_track_id}</span>
            </div>
          )}
          {compact && selectedGenre && (
            <Badge variant="secondary" className="text-xs mt-1 capitalize">{selectedGenre.nome}</Badge>
          )}
        </div>
      </div>
    );
  };

  const renderStepIdleOrResolving = () => (
    <div className="space-y-3">
      <Label htmlFor="track-input">Spotify URL, URI ou Track ID</Label>
      <Input
        id="track-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="https://open.spotify.com/track/..."
        autoFocus
        disabled={step === "resolving"}
        onKeyDown={(e) => {
          if (e.key === "Enter" && step === "idle" && input.trim()) doResolve();
        }}
      />
      <p className="text-xs text-muted-foreground">
        O sistema vai buscar a faixa no Spotify e sugerir um gênero. Você confirma antes de distribuir.
      </p>
    </div>
  );

  const renderStepMetadata = () => {
    if (!resolved) return null;
    const detected = resolved.detected;
    const existing = resolved.existing;
    const others = detected?.other_matches ?? [];
    return (
      <div className="space-y-4">
        {renderTrackCard(false)}

        {existing && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm">
            <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium">Esta música já existe no catálogo.</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Gênero atual: <span className="capitalize font-medium">{existing.current_genre_name ?? "(não definido)"}</span>.
                Será atualizado se você escolher outro. Placements existentes serão preservados.
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Gênero da música</Label>
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
            <div className="text-xs text-muted-foreground space-y-1">
              <div>
                Detectado pelo Spotify: <span className="font-medium capitalize">{detected.suggested_genre_name}</span>
              </div>
              {others.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span>Outras opções detectadas:</span>
                  {others.map((o) => (
                    <button
                      key={o.genre_id}
                      type="button"
                      onClick={() => setSelectedGenreId(o.genre_id)}
                      className="px-2 py-0.5 rounded bg-muted hover:bg-muted/70 capitalize text-xs"
                    >
                      {o.genre_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
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

  const renderStepPreview = () => {
    if (!preview || !resolved) return null;
    const eligibleCount = preview.eligible_count ?? 0;
    const presentCount = preview.already_present_count ?? 0;
    const noCapCount = preview.no_capacity_count ?? 0;
    return (
      <div className="space-y-4">
        {renderTrackCard(true)}

        {preview.track_exists && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm">
            <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Música já existe no catálogo.</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Apenas novos placements serão criados. Nada será duplicado.
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="p-3 rounded-lg bg-primary/10 border border-primary/30">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Compatíveis</div>
            <div className="text-2xl font-semibold tabular-nums text-primary">{eligibleCount}</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Já presentes</div>
            <div className="text-2xl font-semibold tabular-nums">{presentCount}</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Sem vaga</div>
            <div className="text-2xl font-semibold tabular-nums">{noCapCount}</div>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-muted/30 border border-border space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Pool do gênero <span className="capitalize font-medium text-foreground">{preview.genre_name}</span></span>
            <span className="tabular-nums">{preview.genre_pool_total ?? 0} playlists</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Capacidade livre total</span>
            <span className="tabular-nums font-medium text-foreground">{fmtNum(preview.genre_capacity_free)} vagas</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Capacidade utilizada</span>
            <span className="tabular-nums">{fmtNum(preview.genre_capacity_used)} / {fmtNum(preview.genre_capacity_total)}</span>
          </div>
        </div>

        {eligibleCount === 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium">Nenhuma playlist compatível com vaga em <span className="capitalize">{preview.genre_name}</span>.</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {preview.genre_pool_total === 0
                  ? "Esse gênero não tem playlists cadastradas no catálogo."
                  : "Todas as playlists do gênero estão lotadas ou já contêm a faixa. A faixa será registrada sem placements."}
              </div>
            </div>
          </div>
        )}

        {eligibleCount > 0 && (
          <details className="text-sm" open>
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
              Ver as {eligibleCount} playlists compatíveis
            </summary>
            <div className="mt-2 max-h-64 overflow-y-auto space-y-1.5 pr-1">
              {preview.eligible?.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 text-xs py-2 px-2 rounded-md bg-muted/20 border border-border"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="truncate text-sm text-foreground">{p.name}</div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Catálogo</Badge>
                      <span className="text-muted-foreground tabular-nums">
                        entra na posição <span className="font-medium text-foreground">#{p.projected_position ?? "?"}</span>
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground tabular-nums">
                        {fmtNum(p.tracks_count)} faixas
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <div className="text-muted-foreground tabular-nums">{fmtNum(p.followers)} fãs</div>
                    <div className="text-muted-foreground tabular-nums">{p.available_slots ?? 0} vagas</div>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
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
                ? "Música nova adicionada ao catálogo."
                : distributed.track?.genre_changed
                  ? "Música já existia — gênero atualizado e expansão executada."
                  : "Música já existia — expansão para playlists novas."}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="p-3 rounded-lg bg-primary/10 border border-primary/30">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Placements criados</div>
            <div className="text-2xl font-semibold tabular-nums text-primary">{distributed.placements_created ?? 0}</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Compatíveis</div>
            <div className="text-2xl font-semibold tabular-nums">{distributed.total_eligible_playlists ?? 0}</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Já presentes</div>
            <div className="text-xl font-semibold tabular-nums">{distributed.skipped_already_present ?? 0}</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Sem vaga</div>
            <div className="text-xl font-semibold tabular-nums">{distributed.skipped_no_capacity ?? 0}</div>
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
    "Adicionar música ao catálogo";

  const description =
    step === "idle" || step === "resolving"
      ? "Cole a URL, URI ou Track ID da faixa. O sistema busca os metadados antes de distribuir."
      : step === "metadata"
        ? "Confirme o gênero antes de visualizar o impacto da distribuição."
        : step === "preview" || step === "previewing" || step === "distributing"
          ? "Revise o impacto antes de criar os placements."
          : undefined;

  const isBusy = step === "resolving" || step === "previewing" || step === "distributing";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[90dvh] overflow-y-auto p-5 sm:p-6 gap-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {(step === "idle" || step === "resolving") && renderStepIdleOrResolving()}
        {step === "metadata" && renderStepMetadata()}
        {(step === "previewing" || step === "preview" || step === "distributing") && (
          step === "previewing"
            ? <div className="py-8 flex items-center justify-center text-sm text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Calculando preview…</div>
            : renderStepPreview()
        )}
        {step === "done" && renderStepDone()}
        {step === "error" && renderStepError()}

        <DialogFooter className="gap-2 sm:gap-2">
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
                  : `Distribuir ${preview?.eligible_count ?? 0} placements`}
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
      </DialogContent>
    </Dialog>
  );
}
