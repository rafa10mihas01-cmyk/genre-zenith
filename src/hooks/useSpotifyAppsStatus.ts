// Visibilidade operacional dos apps Spotify — hooks somente leitura.
// Fonte: RPCs `get_spotify_apps_status` e `get_spotify_app_for_playlist`
// (SECURITY DEFINER, gated por `has_team_access()`).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppLevel = "healthy" | "attention" | "blocked";

export type SpotifyAppStatusRow = {
  app_id: string;
  app_name: string;
  app_status: string;
  auth_failure_count: number;
  quarantined_until: string | null;
  circuit_status: string;
  blocked_until: string | null;
  retry_after_sec: number;
  last_429_at: string | null;
  playlists_count: number;
  level: AppLevel;
};

export type SpotifyAppForPlaylist = {
  app_id: string;
  app_name: string;
  app_status: string;
  auth_failure_count: number;
  circuit_status: string;
  blocked_until: string | null;
  retry_after_sec: number;
  playlists_count: number;
  level: AppLevel;
};

export function useSpotifyAppsStatus() {
  return useQuery({
    queryKey: ["spotify-apps-status"],
    staleTime: 60_000,
    queryFn: async (): Promise<SpotifyAppStatusRow[]> => {
      const { data, error } = await supabase.rpc("get_spotify_apps_status");
      if (error) throw error;
      return (data ?? []) as SpotifyAppStatusRow[];
    },
  });
}

export function useSpotifyAppForPlaylist(playlistId?: string | null) {
  return useQuery({
    queryKey: ["spotify-app-for-playlist", playlistId],
    enabled: !!playlistId,
    staleTime: 60_000,
    queryFn: async (): Promise<SpotifyAppForPlaylist | null> => {
      const { data, error } = await supabase.rpc("get_spotify_app_for_playlist", {
        p_playlist_id: playlistId!,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as SpotifyAppForPlaylist | null;
    },
  });
}
