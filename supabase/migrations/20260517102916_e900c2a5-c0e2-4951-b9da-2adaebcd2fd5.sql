CREATE TABLE public.managed_playlist_tracks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  playlist_id UUID NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  spotify_track_id TEXT NOT NULL,
  track_name TEXT,
  artist_name TEXT,
  album_cover TEXT,
  position INTEGER NOT NULL,
  added_at TIMESTAMPTZ,
  duration_ms INTEGER,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX managed_playlist_tracks_pl_pos_idx
  ON public.managed_playlist_tracks(playlist_id, position);
CREATE INDEX managed_playlist_tracks_track_idx
  ON public.managed_playlist_tracks(spotify_track_id);
CREATE INDEX managed_playlist_tracks_pl_idx
  ON public.managed_playlist_tracks(playlist_id);

ALTER TABLE public.managed_playlist_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_mpt"
ON public.managed_playlist_tracks
FOR SELECT
TO authenticated
USING (public.has_team_access());

CREATE POLICY "team_insert_mpt"
ON public.managed_playlist_tracks
FOR INSERT
TO authenticated
WITH CHECK (public.has_team_access());

CREATE POLICY "team_update_mpt"
ON public.managed_playlist_tracks
FOR UPDATE
TO authenticated
USING (public.has_team_access());

CREATE POLICY "team_delete_mpt"
ON public.managed_playlist_tracks
FOR DELETE
TO authenticated
USING (public.has_team_access());