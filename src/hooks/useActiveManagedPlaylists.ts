// Hook único de managed_playlists "em operação".
// Pós-refatoração de categoria (CAMPAIGN/CATALOG/ARCHIVED):
//   - scope='campaign' (default) → só playlists premium de campanha (208 hoje)
//   - scope='all'                → CAMPAIGN + CATALOG (898 hoje)
//   - scope='catalog'            → só CATALOG (690 hoje)
// `playlist_type=ARCHIVED` nunca entra (são apenas histórico).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ActiveManagedPlaylist = {
  id: string;
  name: string | null;
  followers: number | null;
  spotify_playlist_id: string | null;
  canonical_playlist_id: string | null;
  playlist_type: "CAMPAIGN" | "CATALOG" | "ARCHIVED";
};

export type ActiveScope = "campaign" | "catalog" | "all";

export function useActiveManagedPlaylists(scope: ActiveScope = "campaign") {
  return useQuery({
    queryKey: ["active_managed_playlists", scope],
    staleTime: 60_000,
    queryFn: async (): Promise<ActiveManagedPlaylist[]> => {
      let q = supabase
        .from("managed_playlists")
        .select("id, name, followers, spotify_playlist_id, canonical_playlist_id, playlist_type");
      if (scope === "campaign") q = q.eq("playlist_type", "CAMPAIGN");
      else if (scope === "catalog") q = q.eq("playlist_type", "CATALOG");
      else q = q.neq("playlist_type", "ARCHIVED");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ActiveManagedPlaylist[];
    },
  });
}
