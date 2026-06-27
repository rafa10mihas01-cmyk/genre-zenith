-- =========================================================
-- Fonte de verdade única da "posição atual": managed_playlist_tracks.position
-- catalog_placements.position permanece apenas como registro histórico
-- da posição no momento da inserção (entry_position).
-- =========================================================

COMMENT ON COLUMN public.catalog_placements.position IS
  'HISTÓRICO: posição usada/observada no momento da inserção (entry_position). '
  'NÃO é atualizado pelo sync. Para "posição atual" sempre consultar '
  'managed_playlist_tracks.position via v_catalog_placement_live ou JOIN '
  '(playlist_id, spotify_track_id).';

-- ---------------------------------------------------------
-- View canônica: catalog_placements + posição viva
-- ---------------------------------------------------------
DROP VIEW IF EXISTS public.v_catalog_placement_live CASCADE;
CREATE VIEW public.v_catalog_placement_live
WITH (security_invoker = true)
AS
SELECT
  cp.id,
  cp.catalog_track_id,
  cp.managed_playlist_id,
  cp.status,
  cp.position           AS entry_position,
  mpt.position          AS current_position,
  cp.added_at,
  cp.scheduled_for,
  cp.attempts,
  cp.last_error_code,
  cp.distribution_batch_id,
  mp.name               AS playlist_name,
  mp.cover_url          AS playlist_cover_url,
  mp.followers          AS playlist_followers,
  mp.spotify_playlist_id,
  mp.archived_at        AS playlist_archived_at,
  mp.execution_mode     AS playlist_execution_mode,
  ct.spotify_track_id,
  mpt.snapshot_at       AS position_observed_at
FROM public.catalog_placements cp
JOIN public.catalog_tracks   ct ON ct.id = cp.catalog_track_id
JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
LEFT JOIN public.managed_playlist_tracks mpt
  ON mpt.playlist_id      = cp.managed_playlist_id
 AND mpt.spotify_track_id = ct.spotify_track_id;

GRANT SELECT ON public.v_catalog_placement_live TO authenticated, service_role;

COMMENT ON VIEW public.v_catalog_placement_live IS
  'View canônica de placements do catálogo. current_position = posição viva '
  '(managed_playlist_tracks, reconciliada pelo sync). entry_position = histórica '
  '(catalog_placements.position, não muda após inserção). Use sempre current_position '
  'para exibir "onde a faixa está agora".';

-- ---------------------------------------------------------
-- Recriar v_catalog_track_playlist_attribution
-- current_position passa a vir de managed_playlist_tracks
-- (cai para NULL quando a playlist não é managed)
-- ---------------------------------------------------------
DROP VIEW IF EXISTS public.v_catalog_track_playlist_attribution CASCADE;
CREATE VIEW public.v_catalog_track_playlist_attribution
WITH (security_invoker = true)
AS
WITH per_track_playlist AS (
  SELECT
    s.catalog_track_id,
    ssp.spotify_playlist_id,
    MAX(ssp.name)        AS name,
    MAX(ssp.owner)       AS owner,
    MAX(ssp.spotify_url) AS spotify_url,
    MIN(s.captured_at)   AS first_seen_at,
    MAX(s.captured_at)   AS last_seen_at,
    COUNT(*)             AS observations
  FROM public.song_snapshots s
  JOIN public.song_snapshot_playlists ssp ON ssp.snapshot_id = s.id
  WHERE s.catalog_track_id IS NOT NULL
    AND ssp.spotify_playlist_id IS NOT NULL
  GROUP BY s.catalog_track_id, ssp.spotify_playlist_id
),
latest_snap AS (
  SELECT DISTINCT ON (s.catalog_track_id)
    s.catalog_track_id, s.id AS snapshot_id, s.captured_at
  FROM public.song_snapshots s
  WHERE s.catalog_track_id IS NOT NULL
  ORDER BY s.catalog_track_id, s.captured_at DESC
),
latest_plays AS (
  SELECT
    ls.catalog_track_id,
    ssp.spotify_playlist_id,
    ssp.plays_7d AS current_plays_7d
  FROM latest_snap ls
  JOIN public.song_snapshot_playlists ssp ON ssp.snapshot_id = ls.snapshot_id
),
-- posição viva vem APENAS de managed_playlist_tracks (fonte oficial pós-sync)
live_position AS (
  SELECT
    ct.id              AS catalog_track_id,
    mp.spotify_playlist_id,
    mpt.position       AS current_position
  FROM public.managed_playlist_tracks mpt
  JOIN public.managed_playlists mp ON mp.id = mpt.playlist_id
  JOIN public.catalog_tracks    ct ON ct.spotify_track_id = mpt.spotify_track_id
)
SELECT
  ptp.catalog_track_id,
  ptp.spotify_playlist_id,
  ptp.name,
  ptp.owner,
  ptp.spotify_url,
  ptp.first_seen_at,
  ptp.last_seen_at,
  ptp.observations,
  lp.current_position,
  lpl.current_plays_7d,
  CASE WHEN lpl.spotify_playlist_id IS NULL THEN 'left' ELSE 'active' END AS status
FROM per_track_playlist ptp
LEFT JOIN latest_plays lpl
  ON lpl.catalog_track_id   = ptp.catalog_track_id
 AND lpl.spotify_playlist_id = ptp.spotify_playlist_id
LEFT JOIN live_position lp
  ON lp.catalog_track_id    = ptp.catalog_track_id
 AND lp.spotify_playlist_id = ptp.spotify_playlist_id;

GRANT SELECT ON public.v_catalog_track_playlist_attribution TO authenticated, service_role;

COMMENT ON VIEW public.v_catalog_track_playlist_attribution IS
  'Atribuição por playlist para o Catálogo. current_position vem SEMPRE de '
  'managed_playlist_tracks (única fonte de verdade da posição atual). '
  'current_plays_7d vem do último snapshot da VPS (song_snapshot_playlists). '
  'NULL em current_position significa playlist não-managed ou faixa fora da playlist.';