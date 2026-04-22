CREATE OR REPLACE VIEW public.v_brain_health AS
WITH stats AS (
  SELECT
    COUNT(*)::int AS total_playlists,
    COUNT(*) FILTER (WHERE seguidores IS NOT NULL)::int AS with_followers,
    COUNT(*) FILTER (WHERE needs_enrich = true)::int AS pending_enrich,
    COUNT(*) FILTER (WHERE is_valid = false)::int AS invalid_records,
    COUNT(*) FILTER (WHERE enrich_failed = true)::int AS enrich_failed_count,
    COUNT(*) FILTER (WHERE seguidores IS NOT NULL AND needs_enrich = true)::int AS stuck_enrich_loop,
    MAX(last_seen_at) AS last_collection_at,
    AVG(quality_score) FILTER (WHERE quality_score IS NOT NULL)::numeric(5,2) AS avg_quality_score
  FROM public.search_results
),
dups AS (
  SELECT COUNT(*)::int AS duplicate_count
  FROM (
    SELECT genre_id, spotify_playlist_id
    FROM public.search_results
    WHERE spotify_playlist_id IS NOT NULL
    GROUP BY genre_id, spotify_playlist_id
    HAVING COUNT(*) > 1
  ) d
),
flag AS (
  SELECT apify_blocked, apify_blocked_at, apify_blocked_reason
  FROM public.system_flags
  ORDER BY created_at ASC
  LIMIT 1
),
genres_summary AS (
  SELECT
    COUNT(*)::int AS total_genres,
    COUNT(*) FILTER (WHERE status = 'analisado')::int AS analyzed_genres
  FROM public.genres
  WHERE ativo = true
)
SELECT
  s.total_playlists,
  s.with_followers,
  s.pending_enrich,
  s.invalid_records,
  s.enrich_failed_count,
  s.stuck_enrich_loop,
  d.duplicate_count,
  s.avg_quality_score,
  s.last_collection_at,
  CASE
    WHEN s.total_playlists = 0 THEN 0
    ELSE ROUND((s.with_followers::numeric / s.total_playlists) * 100, 2)
  END AS followers_coverage_pct,
  CASE
    WHEN s.total_playlists = 0 THEN 0
    ELSE ROUND((s.pending_enrich::numeric / s.total_playlists) * 100, 2)
  END AS needs_enrich_pct,
  COALESCE(f.apify_blocked, false) AS apify_blocked,
  f.apify_blocked_at,
  f.apify_blocked_reason,
  g.total_genres,
  g.analyzed_genres,
  CASE
    WHEN COALESCE(f.apify_blocked, false) = true THEN 'BLOCKED'
    WHEN s.total_playlists = 0 THEN 'OPEN'
    WHEN d.duplicate_count > 0 THEN 'OPEN'
    WHEN s.invalid_records > (s.total_playlists * 0.05) THEN 'OPEN'
    WHEN s.with_followers < (s.total_playlists * 0.95) THEN 'OPEN'
    WHEN s.stuck_enrich_loop > 0 THEN 'OPEN'
    ELSE 'CLOSED'
  END AS brain_status,
  jsonb_build_object(
    'followers_coverage_ok', s.total_playlists > 0 AND s.with_followers >= (s.total_playlists * 0.95),
    'needs_enrich_ok', s.total_playlists = 0 OR s.pending_enrich <= (s.total_playlists * 0.05),
    'no_duplicates', d.duplicate_count = 0,
    'no_invalid', s.invalid_records <= (s.total_playlists * 0.05),
    'no_stuck_loop', s.stuck_enrich_loop = 0,
    'apify_ok', COALESCE(f.apify_blocked, false) = false
  ) AS checks
FROM stats s
CROSS JOIN dups d
CROSS JOIN genres_summary g
LEFT JOIN flag f ON true;

COMMENT ON VIEW public.v_brain_health IS
'Status do Cérebro em 1 query. brain_status=CLOSED significa pronto pra escalar (replicação).';

ALTER VIEW public.v_brain_health SET (security_invoker = true);

GRANT SELECT ON public.v_brain_health TO authenticated;