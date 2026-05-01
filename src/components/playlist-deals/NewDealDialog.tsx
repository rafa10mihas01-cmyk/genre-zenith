import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Search, Music2 } from "lucide-react";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";

const schema = z.object({
  curator_name: z.string().trim().min(1, "Informe o curador").max(120),
  song_spotify_url: z
    .string()
    .trim()
    .min(1, "Informe o link da música")
    .url("Link inválido")
    .max(500),
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

type SongMeta = {
  title: string;
  artist: string | null;
  thumbnail_url: string | null;
};

export interface NewDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function parseTitle(raw: string): { title: string; artist: string | null } {
  // oEmbed do Spotify normalmente devolve apenas o nome da faixa em `title`.
  // Mantemos compat com formatos "Música - Artista" caso apareça.
  const parts = raw.split(" - ");
  if (parts.length >= 2) {
    return { title: parts[0].trim(), artist: parts.slice(1).join(" - ").trim() };
  }
  return { title: raw.trim(), artist: null };
}

export function NewDealDialog({ open, onOpenChange }: NewDealDialogProps) {
  const { addDeal } = useCuratorDeals();
  const [submitting, setSubmitting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [meta, setMeta] = useState<SongMeta | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      curator_name: "",
      song_spotify_url: "",
      target_plays: undefined as unknown as number,
      cost: undefined,
    },
  });

  const handleSearch = async () => {
    const url = form.getValues("song_spotify_url")?.trim();
    if (!url) {
      form.setError("song_spotify_url", { message: "Informe o link primeiro" });
      return;
    }
    setSearching(true);
    setMeta(null);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-spotify-meta", {
        body: { url },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Não foi possível buscar a música");
      const { title, artist } = parseTitle(data.title || "");
      setMeta({
        title: title || "Música",
        artist,
        thumbnail_url: data.thumbnail_url ?? null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Não foi possível buscar a música", { description: msg });
    } finally {
      setSearching(false);
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (!meta) {
      toast.error("Busque a música primeiro", {
        description: "Cole o link e clique em Buscar antes de salvar",
      });
      return;
    }
    setSubmitting(true);
    try {
      const deal = await addDeal({
        curator_name: values.curator_name.trim(),
        song_spotify_url: values.song_spotify_url.trim(),
        song_name: meta.title,
        song_artist: meta.artist,
        song_cover_url: meta.thumbnail_url,
        target_plays: values.target_plays,
        baseline_plays: 0,
        cost:
          typeof values.cost === "number" && !Number.isNaN(values.cost)
            ? values.cost
            : null,
      });

      const link = `${window.location.origin}/curador/${deal.public_token}`;
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        // clipboard pode falhar em contextos não seguros; apenas seguimos
      }

      toast.success("Deal criado", {
        description: "Link do curador copiado para a área de transferência",
      });

      form.reset();
      setMeta(null);
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Não foi possível salvar o deal", { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      form.reset();
      setMeta(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo Deal</DialogTitle>
          <DialogDescription>
            Cadastre um deal com curador e gere o link de acompanhamento.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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

            <FormField
              control={form.control}
              name="song_spotify_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Link da música no Spotify</FormLabel>
                  <FormControl>
                    <Input
                      type="url"
                      placeholder="https://open.spotify.com/track/..."
                      maxLength={500}
                      {...field}
                      onChange={(e) => {
                        field.onChange(e);
                        if (meta) setMeta(null);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                  <div className="pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={handleSearch}
                      disabled={searching}
                    >
                      {searching ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Search className="h-3.5 w-3.5" />
                      )}
                      Buscar
                    </Button>
                  </div>
                </FormItem>
              )}
            />

            {meta && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                {meta.thumbnail_url ? (
                  <img
                    src={meta.thumbnail_url}
                    alt={meta.title}
                    className="h-10 w-10 rounded-md object-cover shrink-0"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Music2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {meta.title}
                  </div>
                  {meta.artist && (
                    <div className="text-xs text-muted-foreground truncate">
                      {meta.artist}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="target_plays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Meta de plays</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        placeholder="ex: 300000"
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
              <Button
                type="submit"
                disabled={submitting || !form.formState.isValid || !meta}
              >
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
