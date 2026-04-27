-- ============================================================
-- HEALTH STATUS por gênero — função + view (não altera schema)
-- ============================================================
-- Critério (alinhado com Freshness Gate de 14d do autopilot):
--   < 48h         → healthy
--   < 14 dias     → stale
--   >= 14 dias    → dead
--   sem dados     → unknown
--
-- Fonte do timestamp: MAX(search_results.last_seen_at WHERE is_valid).

CREATE OR REPLACE FUNCTION public.get_genre_health(p_genre_id uuid)
RETURNS TABLE(
  health_status text,
  last_seen_at timestamp with time zone,
  hours_since numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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

-- ------------------------------------------------------------
-- View: gêneros + health status pré-calculado
-- Pensada para listagens, dashboards e filtros sem repetir a fórmula.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.genres_with_health
WITH (security_invoker = true)
AS
WITH last_seen AS (
  SELECT
    sr.genre_id,
    MAX(sr.last_seen_at) AS last_seen_at
  FROM public.search_results sr
  WHERE sr.is_valid = true
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

-- Garante acesso para roles autenticadas (RLS herda das tabelas-base via security_invoker).
GRANT SELECT ON public.genres_with_health TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_genre_health(uuid) TO authenticated;