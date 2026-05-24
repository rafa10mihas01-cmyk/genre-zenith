-- 1) playlist_metrics_snapshots.template_id → playlist_templates.id
ALTER TABLE public.playlist_metrics_snapshots
  ADD CONSTRAINT fk_pms_template
  FOREIGN KEY (template_id) REFERENCES public.playlist_templates(id) ON DELETE CASCADE;

-- 2) playlist_followers_snapshots.playlist_spotify_id → managed_playlists.spotify_playlist_id
--    (managed_playlists.spotify_playlist_id precisa ser UNIQUE para servir de target de FK)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'managed_playlists_spotify_playlist_id_key'
  ) THEN
    ALTER TABLE public.managed_playlists
      ADD CONSTRAINT managed_playlists_spotify_playlist_id_key UNIQUE (spotify_playlist_id);
  END IF;
END $$;

ALTER TABLE public.playlist_followers_snapshots
  ADD CONSTRAINT fk_pfs_playlist
  FOREIGN KEY (playlist_spotify_id) REFERENCES public.managed_playlists(spotify_playlist_id) ON DELETE CASCADE;

-- 3) playlist_drift_snapshots.playlist_id → managed_playlists.id
ALTER TABLE public.playlist_drift_snapshots
  ADD CONSTRAINT fk_pds_playlist
  FOREIGN KEY (playlist_id) REFERENCES public.managed_playlists(id) ON DELETE CASCADE;