DROP INDEX IF EXISTS public.uq_search_tracks_genre_track;
DELETE FROM public.search_tracks WHERE spotify_track_id IS NULL;
CREATE UNIQUE INDEX uq_search_tracks_genre_track ON public.search_tracks (genre_id, spotify_track_id);