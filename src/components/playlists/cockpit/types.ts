// -------------------- types (extraído do PlaylistCockpit.tsx) --------------------
// Movido 1:1 sem alteração de shape ou semântica.

export type AnalysisTrack = {
  spotify_track_id: string;
  track_name: string | null;
  artist_name: string | null;
  position: number;
  status: "keep" | "remove" | "promote" | "demote";
  reasons: string[];
  popularity: number | null;
  saturation_pct?: number;
  recurrence_in_genre?: number;
  age_days_in_playlist?: number | null;
  target_position?: number | null;
};

export type Zone = "anchor" | "premium" | "support" | "tail";

export type Suggestion = {
  spotify_track_id: string;
  nome: string;
  artista: string;
  count: number;
  suggested_position: number;
  from_missing_artist?: boolean;
  target_zone?: Zone;
  target_zone_label?: string;
  function_role?: string;
  popularity?: number | null;
};

export type Diagnosis = {
  id: string;
  created_at: string;
  name_current: string | null;
  name_suggestion: string | null;
  name_score: number | null;
  tracks_analysis: AnalysisTrack[];
  tracks_suggestions: Suggestion[];
  tracks_summary: any;
  raw: {
    suggested_description?: string | null;
    description_current?: string | null;
    missing_keywords?: string[];
    missing_in_description?: string[];
    health_status?: "aquecido" | "saudavel" | "frio";
    niche_rank?: number | null;
    niche_total?: number | null;
    market_insights?: {
      ideal_track_count_range?: [number, number] | null;
      avg_saturation_pct?: number | null;
      top_artists?: { name: string; plays_in_niche: number }[];
      top_recurring_tracks?: { title: string | null; artist: string | null; niche_playlists_count: number }[];
      leader_playlists?: { spotify_playlist_id: string; name: string; followers: number; cover_url: string | null }[];
      niche_playlist_count?: number;
    };
    // Sprint 2 — camada editorial
    recommendation_mode?: "hold" | "light" | "moderate" | "structural";
    editorial_justification?: string;
    curatorial_state?: "saudavel" | "observacao" | "leve" | "moderada" | "estrutural" | "cooldown";
    applied_caps?: {
      max_change_pct: number;
      max_change_pct_config: number;
      max_changes: number;
      recommended_remove: number;
      recommended_promote: number;
      recommended_demote: number;
      capped_suggestions: number;
      original_suggestions: number;
    };
    active_cooldowns?: Array<{ action_type: string; cooldown_until: string; days_remaining: number; reason: string | null }>;
  };
};

export type Props = {
  managedId: string;
  spotifyPlaylistId: string;
  spotifyUrl: string;
  playlistName: string;
  coverUrl: string | null;
  followers: number | null;
  tracksCount: number;
  genreId?: string | null;
  genreName?: string | null;
  brainScore?: number | null;
  canonicalPlaylistId?: string | null;
  onBack?: () => void;
};
