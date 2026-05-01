import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import { usePlaylistDeals } from "@/hooks/usePlaylistDeals";

const schema = z.object({
  song: z.string().trim().min(1, "Informe a música").max(200, "Máximo 200 caracteres"),
  playlist: z.string().trim().min(1, "Informe a playlist").max(200, "Máximo 200 caracteres"),
  spotify_url: z
    .string()
    .trim()
    .max(500, "Máximo 500 caracteres")
    .url("Link inválido")
    .optional()
    .or(z.literal("")),
  curator: z.string().trim().max(120, "Máximo 120 caracteres").optional().or(z.literal("")),
  target: z.coerce
    .number({ invalid_type_error: "Informe um número" })
    .int("Use um valor inteiro")
    .min(1, "Meta deve ser pelo menos 1"),
  start_plays: z.coerce
    .number({ invalid_type_error: "Informe um número" })
    .int("Use um valor inteiro")
    .min(0, "Não pode ser negativo")
    .optional(),
  cost: z.coerce
    .number({ invalid_type_error: "Informe um número" })
    .min(0, "Não pode ser negativo")
    .optional()
    .or(z.nan().transform(() => undefined)),
});

type FormValues = z.infer<typeof schema>;

export interface NewDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewDealDialog({ open, onOpenChange }: NewDealDialogProps) {
  const { addDeal } = usePlaylistDeals();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      song: "",
      playlist: "",
      spotify_url: "",
      curator: "",
      target: undefined as unknown as number,
      start_plays: 0,
      cost: undefined,
    },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      await addDeal({
        song: values.song.trim(),
        playlist: values.playlist.trim(),
        spotify_url: values.spotify_url ? values.spotify_url.trim() : null,
        curator: values.curator ? values.curator.trim() : null,
        target: values.target,
        start_plays: values.start_plays ?? 0,
        cost: typeof values.cost === "number" && !Number.isNaN(values.cost) ? values.cost : null,
      });
      toast.success("Deal salvo", { description: `${values.song} — ${values.playlist}` });
      form.reset();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Não foi possível salvar o deal", { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) form.reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo Deal</DialogTitle>
          <DialogDescription>
            Registre um deal com curador para acompanhar a entrega de plays.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="song"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Música</FormLabel>
                  <FormControl>
                    <Input placeholder="Nome da faixa" maxLength={200} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="playlist"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome da playlist</FormLabel>
                  <FormControl>
                    <Input placeholder="ex: Top Sertanejo 2026" maxLength={200} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="spotify_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Link da playlist (Spotify)</FormLabel>
                  <FormControl>
                    <Input
                      type="url"
                      placeholder="https://open.spotify.com/playlist/..."
                      maxLength={500}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="curator"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Curador</FormLabel>
                  <FormControl>
                    <Input placeholder="@curador ou nome" maxLength={120} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="target"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Meta de plays a gerar</FormLabel>
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
                name="start_plays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plays atuais da música</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        placeholder="0"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription>
                      Valor atual no Spotify for Artists ao fechar o deal
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
                disabled={submitting || !form.formState.isValid}
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
