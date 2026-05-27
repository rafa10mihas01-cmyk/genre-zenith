
-- 1) tracks_hash em managed_playlists
ALTER TABLE public.managed_playlists
  ADD COLUMN IF NOT EXISTS tracks_hash TEXT;

-- 2) Dedup managed_playlist_tracks: mantém a row de menor position por (playlist_id, spotify_track_id)
WITH ranked AS (
  SELECT ctid,
         row_number() OVER (
           PARTITION BY playlist_id, spotify_track_id
           ORDER BY position NULLS LAST, ctid
         ) AS rn
  FROM public.managed_playlist_tracks
  WHERE spotify_track_id IS NOT NULL
)
DELETE FROM public.managed_playlist_tracks t
USING ranked r
WHERE t.ctid = r.ctid AND r.rn > 1;

-- 3) Unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'managed_playlist_tracks_playlist_track_uniq'
  ) THEN
    ALTER TABLE public.managed_playlist_tracks
      ADD CONSTRAINT managed_playlist_tracks_playlist_track_uniq
      UNIQUE (playlist_id, spotify_track_id);
  END IF;
END $$;
