
-- Reverter apenas onde a playlist NÃO é do ecossistema interno
WITH wrongly_excluded AS (
  SELECT ccp.id
  FROM curator_campaign_playlists ccp
  LEFT JOIN managed_playlists mp ON mp.spotify_playlist_id = ccp.playlist_id
  LEFT JOIN curator_playlists cp ON cp.spotify_playlist_id = ccp.playlist_id
  LEFT JOIN accounts a ON a.spotify_user_id = cp.spotify_owner_id
  WHERE ccp.baseline_conflict_source = 'manual_reclassification_carnivoro_phase7'
    AND ccp.excluded_from_kpis = TRUE
  GROUP BY ccp.id
  HAVING bool_and(mp.id IS NULL) AND bool_and(a.spotify_user_id IS NULL)
)
UPDATE curator_campaign_playlists ccp
SET excluded_from_kpis = FALSE,
    baseline_conflict_at = NULL,
    baseline_conflict_source = NULL,
    updated_at = now()
WHERE ccp.id IN (SELECT id FROM wrongly_excluded);
