// useCockpitQueries — Fase 4B.3A
// React Query hooks compartilhados pelas peças do Cockpit. Objetivo único:
// deduplicar requisições idênticas que hoje rodam várias vezes (StrictMode em dev,
// e entre componentes diferentes em prod). Nenhuma regra de negócio é alterada.
//
// Convenção de keys (todas estáveis):
//   ["playlist", id]
//   ["managed-playlist", "by-spotify", spotifyPlaylistId]
//   ["managed-playlist", "by-id", managedId]
//   ["genre-name", genreId]
//   ["genres-list"]
//   ["genre-model", genreId]
//   ["playlist-diagnosis", managedId]
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PlaylistRow = {
  id: string;
  spotify_playlist_id: string;
  name: string | null;
  followers: number | null;
  cover_url: string | null;
  genre_id: string | null;
};

export type ManagedRow = {
  id: string;
  name: string | null;
  followers: number | null;
  canonical_playlist_id: string | null;
  spotify_playlist_id: string;
  cover_url: string | null;
  description: string | null;
  tracks_count: number;
  spotify_url: string;
  genre_id: string | null;
};

const MANAGED_COLS =
  "id, name, followers, canonical_playlist_id, spotify_playlist_id, cover_url, description, tracks_count, spotify_url, genre_id";

export function usePlaylistById(id: string | null | undefined) {
  return useQuery({
    queryKey: ["playlist", id],
    enabled: !!id,
    staleTime: 60_000,
    queryFn: async (): Promise<PlaylistRow | null> => {
      const { data } = await supabase
        .from("playlists")
        .select("id, spotify_playlist_id, name, followers, cover_url, genre_id")
        .eq("id", id!)
        .maybeSingle();
      return (data as PlaylistRow | null) ?? null;
    },
  });
}

export function useManagedByPlaylistId(spotifyPlaylistId: string | null | undefined) {
  return useQuery({
    queryKey: ["managed-playlist", "by-spotify", spotifyPlaylistId],
    enabled: !!spotifyPlaylistId,
    staleTime: 60_000,
    queryFn: async (): Promise<ManagedRow | null> => {
      const { data } = await supabase
        .from("managed_playlists")
        .select(MANAGED_COLS)
        .eq("spotify_playlist_id", spotifyPlaylistId!)
        .maybeSingle();
      return (data as ManagedRow | null) ?? null;
    },
  });
}

export function useManagedById(managedId: string | null | undefined) {
  return useQuery({
    queryKey: ["managed-playlist", "by-id", managedId],
    enabled: !!managedId,
    staleTime: 60_000,
    queryFn: async (): Promise<ManagedRow | null> => {
      const { data } = await supabase
        .from("managed_playlists")
        .select(MANAGED_COLS)
        .eq("id", managedId!)
        .maybeSingle();
      return (data as ManagedRow | null) ?? null;
    },
  });
}

export function useGenreName(genreId: string | null | undefined) {
  return useQuery({
    queryKey: ["genre-name", genreId],
    enabled: !!genreId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from("genres")
        .select("nome")
        .eq("id", genreId!)
        .maybeSingle();
      return (data as any)?.nome ?? null;
    },
  });
}

export type GenreOption = { id: string; nome: string };

export function useGenresList(enabled = true) {
  return useQuery({
    queryKey: ["genres-list"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<GenreOption[]> => {
      const { data } = await supabase.from("genres").select("id, nome");
      return (data ?? []) as GenreOption[];
    },
  });
}

export function useGenreModelInsights(genreId: string | null | undefined) {
  return useQuery({
    queryKey: ["genre-model", genreId],
    enabled: !!genreId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<any | null> => {
      const { data } = await supabase
        .from("genre_models")
        .select("insights")
        .eq("genre_id", genreId!)
        .maybeSingle();
      return (data as any)?.insights ?? null;
    },
  });
}

export function usePlaylistDiagnosis(managedId: string | null | undefined) {
  return useQuery({
    queryKey: ["playlist-diagnosis", managedId],
    enabled: !!managedId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("playlist_diagnoses")
        .select(
          "id, created_at, name_current, name_suggestion, name_score, tracks_analysis, tracks_suggestions, tracks_summary, raw",
        )
        .eq("playlist_id", managedId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as any) ?? null;
    },
  });
}
