import { useState } from "react";
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
  started_at: z.date({ required_error: "Informe a data de início" }),
  ends_at: z.date().optional(),
});

type FormValues = z.infer<typeof schema>;

type SongRow = {
  url: string;
  daily_goal: string;
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
  return { url: "", daily_goal: "", meta: null, searching: false };
}

export function NewDealDialog({ open, onOpenChange }: NewDealDialogProps) {
  const { addDeal } = useCuratorDeals();
  const [submitting, setSubmitting] = useState(false);
  const [songs, setSongs] = useState<SongRow[]>([emptySong()]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      curator_name: "",
      target_plays: undefined as unknown as number,
      cost: undefined,
      started_at: new Date(),
      ends_at: undefined,
    },
  });

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
      started_at: new Date(),
      ends_at: undefined,
    });
    setSongs([emptySong()]);
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
    if (values.ends_at && values.ends_at < values.started_at) {
      toast.error("Data fim não pode ser antes do início");
      return;
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
      }));

      const deal = await addDeal({
        curator_name: values.curator_name.trim(),
        song_spotify_url: primary.url.trim(),
        song_name: primary.meta!.title,
        song_artist: primary.meta!.artist,
        song_cover_url: primary.meta!.thumbnail_url,
        target_plays: values.target_plays,
        daily_goal: primary.daily_goal ? Number(primary.daily_goal) : 0,
        baseline_plays: 0,
        cost:
          typeof values.cost === "number" && !Number.isNaN(values.cost)
            ? values.cost
            : null,
        started_at: values.started_at.toISOString(),
        ends_at: values.ends_at ? values.ends_at.toISOString() : null,
        extra_songs: extras,
      });

      const link = `${window.location.origin}/curador/${deal.public_token}`;
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        // ignora
      }
      toast.success("Deal criado", {
        description: `${validSongs.length} música${validSongs.length > 1 ? "s" : ""} • link copiado`,
      });
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
          <DialogTitle>Novo Deal</DialogTitle>
          <DialogDescription>
            Cadastre um deal com curador, defina datas e adicione as músicas envolvidas.
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

            {/* Datas */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="started_at"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Início</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            className={cn(
                              "pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground",
                            )}
                          >
                            {field.value ? (
                              format(field.value, "dd 'de' MMM, yyyy", { locale: ptBR })
                            ) : (
                              <span>Escolher data</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="ends_at"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Fim (opcional)</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            className={cn(
                              "pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground",
                            )}
                          >
                            {field.value ? (
                              format(field.value, "dd 'de' MMM, yyyy", { locale: ptBR })
                            ) : (
                              <span>Escolher data</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
                    className="rounded-lg border border-border bg-muted/20 p-3 space-y-2"
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
                render={({ field }) => (
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
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Custo do deal (R$)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min={0}
                        placeholder="ex: 1500"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
                Salvar deal
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
