-- PART 1: extend search_tracks
ALTER TABLE public.search_tracks
  ADD COLUMN IF NOT EXISTS cover_url    text,
  ADD COLUMN IF NOT EXISTS release_date date,
  ADD COLUMN IF NOT EXISTS popularity   integer,
  ADD COLUMN IF NOT EXISTS album        text,
  ADD COLUMN IF NOT EXISTS duration_ms  integer;

-- extend editorial_history
ALTER TABLE public.editorial_history
  ADD COLUMN IF NOT EXISTS track_name   text,
  ADD COLUMN IF NOT EXISTS artist_name  text,
  ADD COLUMN IF NOT EXISTS cover_url    text,
  ADD COLUMN IF NOT EXISTS release_date date;

-- Dedup existing rows so the unique index can be created.
-- Keep the most-recent coletado_em per (genre_id, spotify_track_id).
DELETE FROM public.search_tracks st
USING public.search_tracks st2
WHERE st.spotify_track_id IS NOT NULL
  AND st.genre_id = st2.genre_id
  AND st.spotify_track_id = st2.spotify_track_id
  AND (st.coletado_em, st.id) < (st2.coletado_em, st2.id);

-- Partial unique index supports ON CONFLICT (genre_id, spotify_track_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_search_tracks_genre_track
  ON public.search_tracks (genre_id, spotify_track_id)
  WHERE spotify_track_id IS NOT NULL;

-- Scoring indexes
CREATE INDEX IF NOT EXISTS idx_search_tracks_release
  ON public.search_tracks (genre_id, release_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_search_tracks_popularity
  ON public.search_tracks (genre_id, popularity DESC NULLS LAST);