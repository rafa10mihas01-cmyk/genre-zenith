import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, Pencil, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useGenresList } from "@/hooks/useCockpitQueries";
import { getErrorMessage } from "@/lib/errors";

type Genre = { id: string; nome: string };

type Props = {
  managedId: string;
  currentGenreName?: string | null;
  onChanged?: (genre: Genre) => void;
};

/**
 * Badge clicável que abre lista de gêneros e atualiza managed_playlists.genre_id
 * (+ playlists.genre_id quando vinculada). Sem dialog, sem modal — popover inline.
 */
export function GenrePicker({ managedId, currentGenreName, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentName, setCurrentName] = useState<string | null>(currentGenreName ?? null);

  useEffect(() => { setCurrentName(currentGenreName ?? null); }, [currentGenreName]);

  // Fase 4B.3A: lista de gêneros via React Query (cache 5min, dedup global).
  // Só dispara o fetch quando o popover é aberto pela primeira vez.
  const { data: genresRaw } = useGenresList(open);
  const genres = useMemo<Genre[]>(() => {
    const PRIORITY = ["funk", "trap", "sertanejo", "pagode", "piseiro", "forró", "rap"];
    const list = (genresRaw ?? []) as Genre[];
    return [...list].sort((a, b) => {
      const ia = PRIORITY.indexOf(a.nome.toLowerCase());
      const ib = PRIORITY.indexOf(b.nome.toLowerCase());
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.nome.localeCompare(b.nome, "pt-BR");
    });
  }, [genresRaw]);


  async function changeTo(g: Genre) {
    setSaving(true);
    try {
      // Atualiza managed_playlists (fonte primária no cockpit)
      const { error: e1 } = await supabase
        .from("managed_playlists")
        .update({ genre_id: g.id })
        .eq("id", managedId);
      if (e1) throw e1;

      // Tenta espelhar em playlists (vínculo canonical). Não falha se não existir.
      const { data: mp } = await supabase
        .from("managed_playlists")
        .select("canonical_playlist_id, spotify_playlist_id")
        .eq("id", managedId)
        .maybeSingle();
      const playlistId = (mp as any)?.canonical_playlist_id;
      if (playlistId) {
        await supabase.from("playlists").update({ genre_id: g.id }).eq("id", playlistId);
      } else if ((mp as any)?.spotify_playlist_id) {
        await supabase
          .from("playlists")
          .update({ genre_id: g.id })
          .eq("spotify_playlist_id", (mp as any).spotify_playlist_id);
      }

      setCurrentName(g.nome);
      setOpen(false);
      toast({ title: "Gênero atualizado", description: `Agora vinculada a ${g.nome}.` });
      onChanged?.(g);
    } catch (e: unknown) {
      toast({ title: "Erro ao mudar gênero", description: getErrorMessage(e) ?? "tente de novo", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold hover:text-foreground transition-colors"
          aria-label="Mudar gênero"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          <span>{currentName ?? "definir gênero"}</span>
          <Pencil className="h-2.5 w-2.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-56" align="start">
        <Command>
          <CommandInput placeholder="Buscar gênero…" className="h-9" />
          <CommandList>
            <CommandEmpty>Nenhum gênero.</CommandEmpty>
            <CommandGroup>
              {genres.map((g) => (
                <CommandItem
                  key={g.id}
                  value={g.nome}
                  onSelect={() => changeTo(g)}
                  className="text-xs"
                >
                  <Check className={`h-3 w-3 mr-2 ${currentName === g.nome ? "opacity-100" : "opacity-0"}`} />
                  {g.nome}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
