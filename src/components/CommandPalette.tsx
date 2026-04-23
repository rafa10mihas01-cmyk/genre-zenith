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
            <span>Cockpit</span>
            <CommandShortcut>G H</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/cerebro")}>
            <Brain />
            <span>Cérebro</span>
            <CommandShortcut>G C</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/criacao")}>
            <Sparkles />
            <span>Criação</span>
            <CommandShortcut>G R</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/operacao")}>
            <Activity />
            <span>Operação</span>
            <CommandShortcut>G O</CommandShortcut>
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
          <CommandItem onSelect={() => go("/criacao?tier=hot")}>
            <Rocket />
            <span>Publicar melhores templates</span>
          </CommandItem>
          <CommandItem onSelect={() => go("/criacao?tier=hot&filter=no-cover")}>
            <ImageIcon />
            <span>Templates sem capa</span>
          </CommandItem>
          <CommandItem onSelect={() => go("/operacao")}>
            <RefreshCw />
            <span>Ver coleta / atividade</span>
          </CommandItem>
        </CommandGroup>

        {genres.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Gêneros">
              {genres.map((g) => (
                <CommandItem
                  key={g.id}
                  // value inclui slug + nome para busca match em ambos
                  value={`${g.nome} ${g.slug}`}
                  onSelect={() => go(`/cerebro/${g.slug}`)}
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
