// useCatalogTrackIntelligence
// Hook único que coleta TODA a matéria-prima necessária pra renderizar os
// painéis Enterprise do detalhe da música (timeline, ranking de playlist,
// linha do tempo dos placements, saúde operacional, feed de eventos,
// histórico de distribuição).
//
// REGRAS DE OURO:
//   - Não cria nova coleta.
//   - Não chama nenhuma edge function nova.
//   - Não duplica dados que CatalogoMusicaDetalhe já busca (track, baseline,
//     telemetria, placements, attribution, queue, snapshots, batches).
//   - Tudo aqui é leitura direta de tabelas / views existentes:
//       catalog_placement_execution_log
//       observer_playlist_tracks
//       playlist_followers_snapshots
//       spotify_circuit_breaker
//       v_playlist_vps_assignment
//       song_snapshots + song_snapshot_playlists (série por playlist × dia)
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ExecutionLogRow = {
  id: string;
  placement_id: string | null;
  managed_playlist_id: string | null;
  spotify_playlist_id: string | null;
  position: number | null;
  outcome: string;
  error_code: string | null;
  error_message: string | null;
  snapshot_id: string | null;
  executed_at: string;
};

export type ObserverTrackRow = {
  spotify_playlist_id: string;
  position: number | null;
  captured_at: string;
  captured_date: string;
};

export type PlaylistFollowersRow = {
  playlist_spotify_id: string;
  followers: number | null;
  total_tracks: number | null;
  captured_at: string;
};

export type CircuitBreakerRow = {
  app_id: string;
  status: string;
  blocked_until: string | null;
  retry_after_sec: number | null;
  last_429_at: string | null;
  updated_at: string;
};

export type VpsAssignmentRow = {
  spotify_playlist_id: string;
  vps_node_id: string | null;
  vps_label: string | null;
};

export type SongSnapPlaylistRow = {
  snapshot_id: string;
  spotify_playlist_id: string;
  name: string | null;
  owner: string | null;
  plays_7d: number | null;
  position: number | null;
  created_at: string;
  spotify_url: string | null;
};

export type Intelligence = {
  executionLog: ExecutionLogRow[];
  observerTracks: ObserverTrackRow[];
  followersHistory: PlaylistFollowersRow[];
  breakers: CircuitBreakerRow[];
  vpsAssignments: VpsAssignmentRow[];
  songSnapPlaylists: SongSnapPlaylistRow[];
};

async function fetchIntelligence(
  catalogTrackId: string,
  spotifyTrackId: string,
  spotifyPlaylistIds: string[],
  snapshotIds: string[],
): Promise<Intelligence> {
  const [
    execRes,
    obsRes,
    folRes,
    brkRes,
    vpsRes,
    ssPlRes,
  ] = await Promise.all([
    supabase
      .from("catalog_placement_execution_log")
      .select(
        "id, placement_id, managed_playlist_id, spotify_playlist_id, position, outcome, error_code, error_message, snapshot_id, executed_at",
      )
      .eq("catalog_track_id", catalogTrackId)
      .order("executed_at", { ascending: false })
      .limit(500),

    spotifyTrackId
      ? supabase
          .from("observer_playlist_tracks")
          .select("spotify_playlist_id, position, captured_at, captured_date")
          .eq("spotify_track_id", spotifyTrackId)
          .order("captured_at", { ascending: true })
          .limit(2000)
      : Promise.resolve({ data: [] as ObserverTrackRow[] }),

    spotifyPlaylistIds.length
      ? supabase
          .from("playlist_followers_snapshots")
          .select("playlist_spotify_id, followers, total_tracks, captured_at")
          .in("playlist_spotify_id", spotifyPlaylistIds)
          .order("captured_at", { ascending: true })
          .limit(2000)
      : Promise.resolve({ data: [] as PlaylistFollowersRow[] }),

    supabase
      .from("spotify_circuit_breaker")
      .select("app_id, status, blocked_until, retry_after_sec, last_429_at, updated_at"),

    spotifyPlaylistIds.length
      ? supabase
          .from("v_playlist_vps_assignment")
          .select("spotify_playlist_id, vps_node_id, vps_label")
          .in("spotify_playlist_id", spotifyPlaylistIds)
      : Promise.resolve({ data: [] as VpsAssignmentRow[] }),

    snapshotIds.length
      ? supabase
          .from("song_snapshot_playlists")
          .select("snapshot_id, spotify_playlist_id, name, owner, plays_7d, position, created_at, spotify_url")
          .in("snapshot_id", snapshotIds)
          .order("created_at", { ascending: true })
          .limit(5000)
      : Promise.resolve({ data: [] as SongSnapPlaylistRow[] }),
  ]);

  return {
    executionLog: (execRes.data ?? []) as ExecutionLogRow[],
    observerTracks: (obsRes.data ?? []) as ObserverTrackRow[],
    followersHistory: (folRes.data ?? []) as PlaylistFollowersRow[],
    breakers: (brkRes.data ?? []) as CircuitBreakerRow[],
    vpsAssignments: (vpsRes.data ?? []) as VpsAssignmentRow[],
    songSnapPlaylists: (ssPlRes.data ?? []) as SongSnapPlaylistRow[],
  };
}

export function useCatalogTrackIntelligence(args: {
  catalogTrackId: string;
  spotifyTrackId: string;
  spotifyPlaylistIds: string[];
  snapshotIds: string[];
  enabled?: boolean;
}) {
  const { catalogTrackId, spotifyTrackId, spotifyPlaylistIds, snapshotIds, enabled = true } = args;
  return useQuery({
    queryKey: [
      "catalog",
      "intelligence",
      catalogTrackId,
      spotifyTrackId,
      spotifyPlaylistIds.length,
      snapshotIds.length,
    ],
    queryFn: () =>
      fetchIntelligence(catalogTrackId, spotifyTrackId, spotifyPlaylistIds, snapshotIds),
    enabled: enabled && !!catalogTrackId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
