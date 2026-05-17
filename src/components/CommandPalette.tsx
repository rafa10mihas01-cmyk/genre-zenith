import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Home, Brain, Sparkles, Activity, BarChart3, Settings,
  Rocket, Image as ImageIcon, Search as SearchIcon, RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Genre = { id: string; slug: string; nome: string };

/**
 * Command Palette global (⌘K / Ctrl+K).
 * Atalho universal de navegação — padrão Linear/Vercel/Spotify.
 * Substitui qualquer "input de busca" no header. Funciona mobile + desktop.
 *
 * Uso: controlado por `open`/`onOpenChange`. O AppLayout cuida do estado e
 * registra o atalho ⌘K + ícone de lupa.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [genres, setGenres] = useState<Genre[]>([]);

  // Carrega gêneros UMA vez (e refaz quando abrir, caso tenham mudado)
  useEffect(() => {
    if (!open) return;
    supabase
      .from("genres")
      .select("id, slug, nome")
      .eq("ativo", true)
      .order("nome")
      .then(({ data }) => setGenres(data ?? []));
  }, [open]);

  const go = (path: string) => {
    onOpenChange(false);
    // pequeno delay pra não sobrepor o fade do dialog
    setTimeout(() => navigate(path), 50);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar páginas, gêneros, ações..." />
      <CommandList>
        <CommandEmpty>Nada encontrado.</CommandEmpty>

        <CommandGroup heading="Navegação">
          <CommandItem onSelect={() => go("/")}>
            <Home />
            <span>Hoje</span>
            <CommandShortcut>G H</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/inteligencia")}>
            <Brain />
            <span>Inteligência</span>
            <CommandShortcut>G I</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/catalogo")}>
            <Activity />
            <span>Catálogo</span>
            <CommandShortcut>G O</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/deals")}>
            <Sparkles />
            <span>Deals</span>
            <CommandShortcut>G D</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/performance")}>
            <BarChart3 />
            <span>Performance</span>
            <CommandShortcut>G P</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/configuracoes")}>
            <Settings />
            <span>Configurações</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Ações rápidas">
          <CommandItem onSelect={() => go("/catalogo")}>
            <RefreshCw />
            <span>Ver coleta / atividade</span>
          </CommandItem>
          <CommandItem onSelect={() => go("/deals?tab=library")}>
            <SearchIcon />
            <span>Procurar curadores</span>
          </CommandItem>
        </CommandGroup>

        {genres.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Gêneros">
              {genres.map((g) => (
                <CommandItem
                  key={g.id}
                  value={`${g.nome} ${g.slug}`}
                  onSelect={() => go(`/inteligencia?genero=${g.slug}`)}
                >
                  <SearchIcon />
                  <span>{g.nome}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
