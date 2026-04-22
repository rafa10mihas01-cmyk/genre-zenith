CREATE TYPE public.followers_source_type AS ENUM ('spotify_api');

ALTER TABLE public.search_results
  ADD COLUMN followers_source public.followers_source_type,
  ADD COLUMN followers_verified_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX idx_search_results_followers_source
  ON public.search_results (followers_source);

CREATE INDEX idx_search_results_followers_verified_at
  ON public.search_results (followers_verified_at DESC NULLS LAST);

CREATE INDEX idx_search_results_revalidation_queue
  ON public.search_results (genre_id, seguidores DESC, followers_verified_at ASC NULLS FIRST)
  WHERE spotify_playlist_id IS NOT NULL AND is_valid = true;

CREATE OR REPLACE FUNCTION public.get_followers_revalidation_candidates(
  p_limit integer DEFAULT 100,
  p_min_followers integer DEFAULT 10000,
  p_stale_before interval DEFAULT interval '7 days'
)
RETURNS TABLE (
  id uuid,
  genre_id uuid,
  spotify_playlist_id text,
  spotify_url text,
  seguidores integer,
  followers_verified_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sr.id,
    sr.genre_id,
    sr.spotify_playlist_id,
    sr.spotify_url,
    sr.seguidores,
    sr.followers_verified_at
  FROM public.search_results sr
  WHERE sr.spotify_playlist_id IS NOT NULL
    AND sr.is_valid = true
    AND sr.seguidores IS NOT NULL
    AND sr.seguidores >= p_min_followers
    AND (
      sr.followers_source IS DISTINCT FROM 'spotify_api'::public.followers_source_type
      OR sr.followers_verified_at IS NULL
      OR sr.followers_verified_at < now() - p_stale_before
    )
  ORDER BY sr.seguidores DESC, sr.followers_verified_at ASC NULLS FIRST
  LIMIT GREATEST(COALESCE(p_limit, 100), 1);
$$;