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
  Home, Sparkles, Activity, BarChart3, Settings, Target, Handshake,
  ListMusic, Server, Users, Search as SearchIcon,
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

        <CommandGroup heading="Cockpit">
          <CommandItem onSelect={() => go("/")}>
            <Home />
            <span>Início</span>
            <CommandShortcut>G H</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Operação">
          <CommandItem onSelect={() => go("/campanhas")}>
            <Target />
            <span>Campanhas</span>
            <CommandShortcut>G C</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/deals")}>
            <Handshake />
            <span>Negociações</span>
            <CommandShortcut>G D</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/deals?tab=library")}>
            <Users />
            <span>Curadores</span>
          </CommandItem>
          <CommandItem onSelect={() => go("/catalogo")}>
            <ListMusic />
            <span>Playlists</span>
            <CommandShortcut>G P</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Inteligência">
          <CommandItem onSelect={() => go("/analytics")}>
            <BarChart3 />
            <span>Analytics</span>
            <CommandShortcut>G A</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/performance")}>
            <Activity />
            <span>Performance</span>
          </CommandItem>
          <CommandItem onSelect={() => go("/valuation")}>
            <BarChart3 />
            <span>Valuation</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Sistema">
          <CommandItem onSelect={() => go("/sistema")}>
            <Server />
            <span>Infra</span>
          </CommandItem>
          <CommandItem onSelect={() => go("/comunidade-admin")}>
            <Users />
            <span>Comunidade</span>
          </CommandItem>
          <CommandItem onSelect={() => go("/configuracoes")}>
            <Settings />
            <span>Configurações</span>
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
                  onSelect={() => go(`/analytics?genero=${g.slug}`)}
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
