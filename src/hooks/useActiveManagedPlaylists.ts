// Fase 4B.1 — query única e compartilhada de managed_playlists ativas.
// Substitui 5 queries duplicadas espalhadas pelos cards da Home.
// Projeção propositalmente larga pra cobrir todos os consumidores.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ActiveManagedPlaylist = {
  id: string;
  name: string | null;
  followers: number | null;
  spotify_playlist_id: string | null;
  canonical_playlist_id: string | null;
};

export function useActiveManagedPlaylists() {
  return useQuery({
    queryKey: ["active_managed_playlists"],
    staleTime: 60_000,
    queryFn: async (): Promise<ActiveManagedPlaylist[]> => {
      const { data, error } = await supabase
        .from("managed_playlists")
        .select("id, name, followers, spotify_playlist_id, canonical_playlist_id")
        .is("archived_at", null);
      if (error) throw error;
      return (data ?? []) as ActiveManagedPlaylist[];
    },
  });
}
