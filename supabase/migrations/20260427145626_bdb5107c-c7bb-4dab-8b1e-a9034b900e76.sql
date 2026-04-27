-- Reduz privilégios da função get_genre_health: SECURITY INVOKER (herda RLS do chamador)
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

-- Revoga execução do anon e public; mantém apenas authenticated.
REVOKE ALL ON FUNCTION public.get_genre_health(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_genre_health(uuid) TO authenticated;

-- Mesmo cuidado para a view: apenas authenticated lê.
REVOKE ALL ON public.genres_with_health FROM PUBLIC, anon;
GRANT SELECT ON public.genres_with_health TO authenticated;