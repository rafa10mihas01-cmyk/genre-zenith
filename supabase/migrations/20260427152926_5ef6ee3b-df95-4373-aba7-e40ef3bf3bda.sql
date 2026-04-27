-- P1 (Ghost Health fix): saúde do gênero agora exige enriquecimento real.
-- Antes: bastava is_valid=true (que era setado pré-enrich com 'pre_enrich').
-- Depois: exige followers_source = 'spotify_api' (set apenas pelo enrich-playlists
-- após verificar followers no Spotify). Isso elimina o "ghost healthy".

CREATE OR REPLACE FUNCTION public.get_genre_health(p_genre_id uuid)
RETURNS TABLE(
  health_status text,
  last_seen_at timestamp with time zone,
  hours_since numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH last_seen AS (
    SELECT MAX(sr.last_seen_at) AS ts
    FROM public.search_results sr
    WHERE sr.genre_id = p_genre_id
      AND sr.is_valid = true
      AND sr.followers_source = 'spotify_api'::public.followers_source_type
  )
  SELECT
    CASE
      WHEN ls.ts IS NULL THEN 'unknown'
      WHEN ls.ts > now() - interval '48 hours'  THEN 'healthy'
      WHEN ls.ts > now() - interval '14 days'   THEN 'stale'
      ELSE 'dead'
    END AS health_status,
    ls.ts AS last_seen_at,
    CASE
      WHEN ls.ts IS NULL THEN NULL
      ELSE ROUND(EXTRACT(EPOCH FROM (now() - ls.ts)) / 3600.0, 1)
    END AS hours_since
  FROM last_seen ls;
$$;

-- View espelha mesmo critério.
CREATE OR REPLACE VIEW public.genres_with_health
WITH (security_invoker = true)
AS
WITH last_seen AS (
  SELECT
    sr.genre_id,
    MAX(sr.last_seen_at) AS last_seen_at
  FROM public.search_results sr
  WHERE sr.is_valid = true
    AND sr.followers_source = 'spotify_api'::public.followers_source_type
  GROUP BY sr.genre_id
)
SELECT
  g.*,
  ls.last_seen_at AS health_last_seen_at,
  CASE
    WHEN ls.last_seen_at IS NULL                            THEN 'unknown'
    WHEN ls.last_seen_at > now() - interval '48 hours'      THEN 'healthy'
    WHEN ls.last_seen_at > now() - interval '14 days'       THEN 'stale'
    ELSE 'dead'
  END AS health_status,
  CASE
    WHEN ls.last_seen_at IS NULL THEN NULL
    ELSE ROUND(EXTRACT(EPOCH FROM (now() - ls.last_seen_at)) / 3600.0, 1)
  END AS health_hours_since
FROM public.genres g
LEFT JOIN last_seen ls ON ls.genre_id = g.id;

REVOKE ALL ON public.genres_with_health FROM PUBLIC, anon;
GRANT SELECT ON public.genres_with_health TO authenticated;
REVOKE ALL ON FUNCTION public.get_genre_health(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_genre_health(uuid) TO authenticated;