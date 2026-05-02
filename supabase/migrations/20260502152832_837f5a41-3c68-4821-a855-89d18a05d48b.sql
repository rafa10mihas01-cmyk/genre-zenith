-- View de performance + classificação por playlist do catálogo
CREATE OR REPLACE VIEW public.curator_playlist_performance
WITH (security_invoker = true)
AS
WITH playlist_deal_stats AS (
  -- Agrega streams por playlist (matched por spotify_playlist_id ou por nome) e por deal
  SELECT
    lib.id AS library_id,
    lib.curator_id,
    lib.user_id,
    lib.spotify_playlist_id,
    lib.playlist_name,
    cp.deal_id,
    MAX(cp.streams_7d) AS streams_7d,
    MAX(cp.streams_total) AS streams_total
  FROM public.curator_playlist_library lib
  LEFT JOIN public.curator_playlists cp
    ON (
      (lib.spotify_playlist_id IS NOT NULL AND cp.spotify_playlist_id = lib.spotify_playlist_id)
      OR (lib.spotify_playlist_id IS NULL AND lower(trim(cp.playlist_name)) = lower(trim(lib.playlist_name)))
    )
    AND cp.deal_id IN (SELECT id FROM public.curator_deals WHERE curator_id = lib.curator_id)
    AND cp.is_baseline = false
  GROUP BY lib.id, lib.curator_id, lib.user_id, lib.spotify_playlist_id, lib.playlist_name, cp.deal_id
),
agg AS (
  SELECT
    library_id,
    curator_id,
    user_id,
    COUNT(deal_id) FILTER (WHERE deal_id IS NOT NULL) AS deals_count,
    COALESCE(SUM(streams_7d), 0) AS total_streams_7d,
    COALESCE(SUM(streams_total), 0) AS total_streams_lifetime,
    COALESCE(AVG(NULLIF(streams_7d, 0)), 0) AS avg_streams_7d,
    COALESCE(MAX(streams_7d), 0) AS best_streams_7d,
    COALESCE(MIN(NULLIF(streams_7d, 0)), 0) AS worst_streams_7d,
    COALESCE(STDDEV_POP(NULLIF(streams_7d, 0)), 0) AS stddev_streams_7d
  FROM playlist_deal_stats
  GROUP BY library_id, curator_id, user_id
)
SELECT
  a.library_id,
  a.curator_id,
  a.user_id,
  a.deals_count,
  a.total_streams_7d,
  a.total_streams_lifetime,
  ROUND(a.avg_streams_7d)::bigint AS avg_streams_7d,
  a.best_streams_7d,
  a.worst_streams_7d,
  -- Coeficiente de variação (0 = consistente, >1 = errático)
  CASE
    WHEN a.avg_streams_7d > 0 THEN ROUND((a.stddev_streams_7d / a.avg_streams_7d)::numeric, 2)
    ELSE 0
  END AS variation_coef,
  -- Queda relativa do melhor pro pior (0 = igual, 1 = caiu pra zero)
  CASE
    WHEN a.best_streams_7d > 0
      THEN ROUND(((a.best_streams_7d - a.worst_streams_7d)::numeric / a.best_streams_7d), 2)
    ELSE 0
  END AS drop_ratio,
  -- Classificação
  CASE
    WHEN a.deals_count = 0 THEN 'sem_historico'
    WHEN a.deals_count = 1 THEN 'novo'
    -- Suspeita: variação extrema OU queda > 80% entre deals consecutivos
    WHEN a.avg_streams_7d > 0
      AND a.stddev_streams_7d / a.avg_streams_7d > 1.5
      AND a.best_streams_7d > 0
      AND ((a.best_streams_7d - a.worst_streams_7d)::numeric / a.best_streams_7d) > 0.8
      THEN 'suspeita'
    -- Excelente: 3+ deals, média > 500 e variação < 0.5
    WHEN a.deals_count >= 3
      AND a.avg_streams_7d > 500
      AND a.avg_streams_7d > 0
      AND a.stddev_streams_7d / a.avg_streams_7d < 0.5
      THEN 'excelente'
    -- Boa: média > 200 e variação razoável
    WHEN a.avg_streams_7d > 200
      AND (a.avg_streams_7d = 0 OR a.stddev_streams_7d / a.avg_streams_7d < 1.0)
      THEN 'boa'
    -- Fraca: média < 100
    WHEN a.avg_streams_7d < 100 THEN 'fraca'
    ELSE 'media'
  END AS performance_class
FROM agg a;

COMMENT ON VIEW public.curator_playlist_performance IS
  'Performance histórica por playlist do catálogo do curador, com classificação (excelente/boa/media/fraca/suspeita/novo/sem_historico) baseada em consistência e volume médio.';