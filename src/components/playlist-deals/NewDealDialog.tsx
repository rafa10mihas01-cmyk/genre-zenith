import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2,
  Search,
  Music2,
  Plus,
  X,
  CalendarIcon,
  Check,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useCuratorDeals, type DealSongInput } from "@/hooks/useCuratorDeals";
import type { CuratorDeal, CuratorDealSong } from "@/lib/curatorDealsUtils";
import { curatorPublicUrl } from "@/lib/curatorPublicUrl";

const schema = z.object({
  curator_name: z.string().trim().min(1, "Informe o curador").max(120),
  target_plays: z.coerce
    .number({ invalid_type_error: "Informe um número" })
    .int("Use um valor inteiro")
    .min(1, "Meta deve ser pelo menos 1"),
  cost: z.coerce
    .number({ invalid_type_error: "Informe um número" })
    .min(0, "Não pode ser negativo")
    .optional()
    .or(z.nan().transform(() => undefined)),
});

type FormValues = z.infer<typeof schema>;

type SongRow = {
  url: string;
  daily_goal: string;
  started_at: Date | undefined;
  ends_at: Date | undefined;
  ramp_up_days: string;
  meta: {
    title: string;
    artist: string | null;
    thumbnail_url: string | null;
  } | null;
  searching: boolean;
  error?: string;
};

export interface NewDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Quando passado, o diálogo entra em modo edição. */
  editDeal?: CuratorDeal | null;
  /** Músicas associadas ao deal (somente em modo edição). */
  editSongs?: CuratorDealSong[];
}

function parseTitle(raw: string): { title: string; artist: string | null } {
  const parts = raw.split(" - ");
  if (parts.length >= 2) {
    return { title: parts[0].trim(), artist: parts.slice(1).join(" - ").trim() };
  }
  return { title: raw.trim(), artist: null };
}

function extractSpotifyTrackId(url: string): string | null {
  if (!url) return null;
  const m = url.match(/track[/:]([a-zA-Z0-9]{10,})/);
  return m ? m[1] : null;
}

function emptySong(): SongRow {
  return {
    url: "",
    daily_goal: "",
    started_at: new Date(),
    ends_at: undefined,
    ramp_up_days: "5",
    meta: null,
    searching: false,
  };
}

// ---------- Currency helpers (BRL) ----------
function digitsOnly(v: string): string {
  return v.replace(/\D/g, "");
}
function formatCurrencyBRL(rawDigits: string): string {
  if (!rawDigits) return "";
  const cents = parseInt(rawDigits, 10);
  if (Number.isNaN(cents)) return "";
  const value = cents / 100;
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function formatPlaysHint(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  const fmt = (val: number) => {
    const s = val.toFixed(1);
    return s.endsWith(".0") ? s.slice(0, -2) : s.replace(".", ",");
  };
  if (n >= 1_000_000_000) {
    const v = n / 1_000_000_000;
    return `${fmt(v)} ${v === 1 ? "bilhão" : "bilhões"}`;
  }
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${fmt(v)} ${v === 1 ? "milhão" : "milhões"}`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${fmt(v)} mil`;
  }
  return n.toLocaleString("pt-BR");
}

function currencyDigitsToNumber(rawDigits: string): number | undefined {
  if (!rawDigits) return undefined;
  const cents = parseInt(rawDigits, 10);
  if (Number.isNaN(cents)) return undefined;
  return cents / 100;
}

export function NewDealDialog({ open, onOpenChange, editDeal, editSongs }: NewDealDialogProps) {
  const { addDeal, updateDeal } = useCuratorDeals();
  const isEdit = Boolean(editDeal);
  const [submitting, setSubmitting] = useState(false);
  const [songs, setSongs] = useState<SongRow[]>([emptySong()]);
  const [costDigits, setCostDigits] = useState<string>("");

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      curator_name: "",
      target_plays: undefined as unknown as number,
      cost: undefined,
    },
  });

  // Hidrata os campos quando entrar em modo edição (ou quando o deal mudar)
  useEffect(() => {
    if (!open) return;
    if (isEdit && editDeal) {
      form.reset({
        curator_name: editDeal.curator_name ?? "",
        target_plays: Number(editDeal.target_plays ?? 0) || (undefined as unknown as number),
        cost: editDeal.cost != null ? Number(editDeal.cost) : undefined,
      });
      const c = Number(editDeal.cost ?? 0);
      setCostDigits(c > 0 ? String(Math.round(c * 100)) : "");

      const sourceSongs =
        editSongs && editSongs.length > 0
          ? [...editSongs].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          : null;

      if (sourceSongs && sourceSongs.length > 0) {
        setSongs(
          sourceSongs.map((s) => ({
            url: s.song_spotify_url ?? "",
            daily_goal: s.daily_goal ? String(s.daily_goal) : "",
            started_at: s.started_at ? new Date(s.started_at) : new Date(editDeal.started_at),
            ends_at: s.ends_at ? new Date(s.ends_at) : (editDeal.ends_at ? new Date(editDeal.ends_at) : undefined),
            ramp_up_days: String(
              (s as unknown as { ramp_up_days?: number }).ramp_up_days ??
                (editDeal as unknown as { ramp_up_days?: number }).ramp_up_days ??
                5,
            ),
            meta: {
              title: s.song_name ?? "Música",
              artist: s.song_artist ?? null,
              thumbnail_url: s.song_cover_url ?? null,
            },
            searching: false,
          })),
        );
      } else {
        // Fallback: usar campos legacy do deal
        setSongs([
          {
            url: editDeal.song_spotify_url ?? "",
            daily_goal: editDeal.daily_goal ? String(editDeal.daily_goal) : "",
            started_at: new Date(editDeal.started_at),
            ends_at: editDeal.ends_at ? new Date(editDeal.ends_at) : undefined,
            ramp_up_days: String(
              (editDeal as unknown as { ramp_up_days?: number }).ramp_up_days ?? 5,
            ),
            meta: {
              title: editDeal.song_name ?? "Música",
              artist: editDeal.song_artist ?? null,
              thumbnail_url: editDeal.song_cover_url ?? null,
            },
            searching: false,
          },
        ]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, editDeal?.id]);

  const updateSong = (idx: number, patch: Partial<SongRow>) => {
    setSongs((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const handleSearchSong = async (idx: number) => {
    const url = songs[idx].url.trim();
    if (!url) {
      updateSong(idx, { error: "Cole o link primeiro" });
      return;
    }
    updateSong(idx, { searching: true, error: undefined, meta: null });
    try {
      const { data, error } = await supabase.functions.invoke(
        "fetch-spotify-meta",
        { body: { url } },
      );
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Não foi possível buscar");
      const { title, artist } = parseTitle(data.title || "");
      updateSong(idx, {
        meta: {
          title: title || "Música",
          artist,
          thumbnail_url: data.thumbnail_url ?? null,
        },
        searching: false,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateSong(idx, { searching: false, error: msg });
      toast.error("Não foi possível buscar a música", { description: msg });
    }
  };

  const addSongRow = () => setSongs((prev) => [...prev, emptySong()]);
  const removeSongRow = (idx: number) =>
    setSongs((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

  const reset = () => {
    form.reset({
      curator_name: "",
      target_plays: undefined as unknown as number,
      cost: undefined,
    });
    setSongs([emptySong()]);
    setCostDigits("");
  };

  const onSubmit = async (values: FormValues) => {
    const validSongs = songs.filter((s) => s.url.trim() && s.meta);
    if (validSongs.length === 0) {
      toast.error("Adicione pelo menos uma música", {
        description: "Cole o link e clique em Buscar antes de salvar",
      });
      return;
    }
    if (validSongs.length !== songs.filter((s) => s.url.trim()).length) {
      toast.error("Algumas músicas não foram buscadas", {
        description: "Clique em Buscar em todas antes de salvar",
      });
      return;
    }
    // Validar datas por música
    for (let i = 0; i < validSongs.length; i++) {
      const s = validSongs[i];
      if (!s.started_at) {
        toast.error(`Defina a data de início da música ${i + 1}`);
        return;
      }
      if (s.ends_at && s.ends_at < s.started_at) {
        toast.error(`Data fim antes do início na música ${i + 1}`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const [primary, ...rest] = validSongs;
      const extras: DealSongInput[] = rest.map((s, i) => ({
        song_spotify_url: s.url.trim(),
        spotify_track_id: extractSpotifyTrackId(s.url),
        song_name: s.meta!.title,
        song_artist: s.meta!.artist,
        song_cover_url: s.meta!.thumbnail_url,
        daily_goal: s.daily_goal ? Number(s.daily_goal) : 0,
        position: i + 1,
        started_at: s.started_at ? s.started_at.toISOString() : null,
        ends_at: s.ends_at ? s.ends_at.toISOString() : null,
        ramp_up_days: s.ramp_up_days ? Math.max(0, Number(s.ramp_up_days)) : 5,
      }));

      // Janela do deal = menor início e maior fim entre as músicas
      const allStarts = validSongs
        .map((s) => s.started_at)
        .filter((d): d is Date => Boolean(d));
      const allEnds = validSongs
        .map((s) => s.ends_at)
        .filter((d): d is Date => Boolean(d));
      const dealStart = allStarts.reduce(
        (min, d) => (d < min ? d : min),
        allStarts[0],
      );
      const dealEnd =
        allEnds.length === validSongs.length && allEnds.length > 0
          ? allEnds.reduce((max, d) => (d > max ? d : max), allEnds[0])
          : null;

      const costNumber = currencyDigitsToNumber(costDigits);

      const payload = {
        curator_name: values.curator_name.trim(),
        song_spotify_url: primary.url.trim(),
        song_name: primary.meta!.title,
        song_artist: primary.meta!.artist,
        song_cover_url: primary.meta!.thumbnail_url,
        target_plays: values.target_plays,
        daily_goal: primary.daily_goal ? Number(primary.daily_goal) : 0,
        baseline_plays: 0,
        cost: typeof costNumber === "number" ? costNumber : null,
        started_at: dealStart.toISOString(),
        ends_at: dealEnd ? dealEnd.toISOString() : null,
        ramp_up_days: primary.ramp_up_days ? Math.max(0, Number(primary.ramp_up_days)) : 5,
        extra_songs: extras,
      };

      if (isEdit && editDeal) {
        await updateDeal(editDeal.id, payload);
        toast.success("Deal atualizado", {
          description: `${validSongs.length} música${validSongs.length > 1 ? "s" : ""}`,
        });
      } else {
        const deal = await addDeal(payload);
        const link = curatorPublicUrl({ slug: deal.slug, public_token: deal.public_token });
        try {
          await navigator.clipboard.writeText(link);
        } catch {
          // ignora
        }
        toast.success("Deal criado", {
          description: `${validSongs.length} música${validSongs.length > 1 ? "s" : ""} • link copiado`,
        });
      }
      reset();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Não foi possível salvar o deal", { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar deal" : "Novo Deal"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Atualize curador, músicas, datas, aquecimento e valores."
              : "Cadastre um deal com curador e adicione as músicas — cada uma com sua janela de campanha."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            {/* Curador */}
            <FormField
              control={form.control}
              name="curator_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome do curador</FormLabel>
                  <FormControl>
                    <Input placeholder="@curador ou nome" maxLength={120} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Músicas */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FormLabel className="mb-0">
                  Músicas do deal{" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    ({songs.length})
                  </span>
                </FormLabel>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addSongRow}
                  className="gap-1.5 h-8"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Adicionar música
                </Button>
              </div>

              <div className="space-y-3">
                {songs.map((song, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-border bg-muted/20 p-3 space-y-3"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
                        <Input
                          type="url"
                          placeholder="https://open.spotify.com/track/..."
                          value={song.url}
                          maxLength={500}
                          onChange={(e) =>
                            updateSong(idx, {
                              url: e.target.value,
                              meta: null,
                              error: undefined,
                            })
                          }
                        />
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          placeholder="Combinado/dia"
                          value={song.daily_goal}
                          onChange={(e) =>
                            updateSong(idx, { daily_goal: e.target.value })
                          }
                        />
                      </div>
                      {songs.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => removeSongRow(idx)}
                          aria-label="Remover música"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {/* Datas individuais por música */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">
                          Início
                        </span>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className={cn(
                                "h-9 pl-3 text-left font-normal justify-start",
                                !song.started_at && "text-muted-foreground",
                              )}
                            >
                              {song.started_at ? (
                                format(song.started_at, "dd 'de' MMM, yyyy", {
                                  locale: ptBR,
                                })
                              ) : (
                                <span>Escolher data</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={song.started_at}
                              onSelect={(d) =>
                                updateSong(idx, { started_at: d ?? undefined })
                              }
                              initialFocus
                              className={cn("p-3 pointer-events-auto")}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">
                          Fim (opcional)
                        </span>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className={cn(
                                "h-9 pl-3 text-left font-normal justify-start",
                                !song.ends_at && "text-muted-foreground",
                              )}
                            >
                              {song.ends_at ? (
                                format(song.ends_at, "dd 'de' MMM, yyyy", {
                                  locale: ptBR,
                                })
                              ) : (
                                <span>Escolher data</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={song.ends_at}
                              onSelect={(d) =>
                                updateSong(idx, { ends_at: d ?? undefined })
                              }
                              initialFocus
                              className={cn("p-3 pointer-events-auto")}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>

                    {/* Ramp-up + duração */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Aquecimento:
                        </span>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={30}
                          className="h-8 w-16 text-sm"
                          value={song.ramp_up_days}
                          onChange={(e) =>
                            updateSong(idx, { ramp_up_days: e.target.value })
                          }
                        />
                        <span className="text-xs text-muted-foreground">
                          dias sem cobrar meta
                        </span>
                      </div>
                      {song.started_at && song.ends_at && (
                        <div className="text-xs text-muted-foreground ml-auto">
                          Duração:{" "}
                          <span className="text-foreground font-medium">
                            {Math.max(
                              1,
                              Math.round(
                                (song.ends_at.getTime() - song.started_at.getTime()) /
                                  86400000,
                              ) + 1,
                            )}{" "}
                            dias
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {!song.meta ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => handleSearchSong(idx)}
                          disabled={song.searching || !song.url.trim()}
                        >
                          {song.searching ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Search className="h-3.5 w-3.5" />
                          )}
                          Buscar música
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {song.meta.thumbnail_url ? (
                            <img
                              src={song.meta.thumbnail_url}
                              alt={song.meta.title}
                              className="h-9 w-9 rounded-md object-cover shrink-0"
                            />
                          ) : (
                            <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                              <Music2 className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                              <Check className="h-3.5 w-3.5 text-success shrink-0" />
                              {song.meta.title}
                            </div>
                            {song.meta.artist && (
                              <div className="text-xs text-muted-foreground truncate">
                                {song.meta.artist}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {song.error && (
                      <div className="text-xs text-destructive">{song.error}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Combinado total + custo */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="target_plays"
                render={({ field }) => {
                  const n =
                    typeof field.value === "number"
                      ? field.value
                      : Number(field.value);
                  const hint = formatPlaysHint(Number.isFinite(n) ? n : undefined);
                  return (
                    <FormItem>
                      <FormLabel>Combinado total (plays)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          placeholder="ex: 3000000"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      {hint && (
                        <p className="text-xs text-muted-foreground mt-1">
                          ≈ <span className="text-foreground font-medium">{hint}</span> plays
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              <FormItem>
                <FormLabel>Custo do deal</FormLabel>
                <FormControl>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                      R$
                    </span>
                    <Input
                      inputMode="numeric"
                      placeholder="0,00"
                      value={
                        costDigits ? formatCurrencyBRL(costDigits).replace("R$", "").trim() : ""
                      }
                      onChange={(e) => setCostDigits(digitsOnly(e.target.value))}
                      className="pl-9"
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                {isEdit ? "Salvar alterações" : "Salvar deal"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
