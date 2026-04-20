import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { supabase } from "@/integrations/supabase/client";

type Genre = { id: string; nome: string; slug: string };

const PAGES = [
  { label: "Visão Geral", to: "/", hint: "Dashboard" },
  { label: "Cérebro", to: "/brain", hint: "Análise por gênero" },
  { label: "Configurações", to: "/settings", hint: "Preferências" },
];

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [genres, setGenres] = useState<Genre[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.from("genres").select("id,nome,slug").order("nome").then(({ data }) => {
      if (data) setGenres(data);
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(to: string) {
    setOpen(false);
    navigate(to);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="nx-search" aria-label="Buscar">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left text-muted-foreground">Buscar tudo...</span>
        <span className="nx-kbd">⌘K</span>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <VisuallyHidden>
          <DialogTitle>Busca global</DialogTitle>
          <DialogDescription>Buscar páginas e gêneros</DialogDescription>
        </VisuallyHidden>
        <CommandInput placeholder="Buscar páginas, gêneros..." />
        <CommandList>
          <CommandEmpty>Nada encontrado.</CommandEmpty>
          <CommandGroup heading="Páginas">
            {PAGES.map((p) => (
              <CommandItem key={p.to} value={`page ${p.label} ${p.hint}`} onSelect={() => go(p.to)}>
                <span className="flex-1">{p.label}</span>
                <span className="text-xs text-muted-foreground">{p.hint}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          {genres.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Gêneros">
                {genres.map((g) => (
                  <CommandItem
                    key={g.id}
                    value={`genre ${g.nome} ${g.slug}`}
                    onSelect={() => go(`/brain/${g.slug}`)}
                  >
                    <span className="flex-1">{g.nome}</span>
                    <span className="text-xs text-muted-foreground">/brain/{g.slug}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
