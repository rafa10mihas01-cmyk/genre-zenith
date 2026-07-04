
ALTER TABLE public.catalog_placement_execution_log
  ADD COLUMN IF NOT EXISTS position_reason TEXT;

CREATE OR REPLACE FUNCTION public.fn_compute_catalog_target_position(
  _managed_playlist_id UUID,
  _spotify_track_id    TEXT,
  _is_campaign_active  BOOLEAN
) RETURNS TABLE(slot_position INTEGER, reason TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_followers      BIGINT;
  v_track_count    INTEGER;
  v_floor          INTEGER;
  v_hot_zone       INTEGER := 5;
  v_hot_threshold  INTEGER := 5000;
  v_slot           INTEGER;
BEGIN
  SELECT COALESCE(mp.followers, 0)
    INTO v_followers
  FROM managed_playlists mp
  WHERE mp.id = _managed_playlist_id;

  SELECT COUNT(*)::INTEGER
    INTO v_track_count
  FROM managed_playlist_tracks mpt
  WHERE mpt.playlist_id = _managed_playlist_id;

  IF v_track_count IS NULL THEN v_track_count := 0; END IF;

  IF v_followers > v_hot_threshold AND NOT COALESCE(_is_campaign_active, FALSE) THEN
    v_floor := v_hot_zone;
  ELSE
    v_floor := 0;
  END IF;

  IF v_track_count = 0 THEN
    RETURN QUERY SELECT 0, format('empty_playlist floor=%s followers=%s campaign=%s',
      v_floor, v_followers, _is_campaign_active);
    RETURN;
  END IF;

  WITH ordered AS (
    SELECT
      mpt.position AS pos,
      EXISTS (
        SELECT 1 FROM catalog_tracks ct
        WHERE ct.spotify_track_id = mpt.spotify_track_id
      ) AS is_catalog
    FROM managed_playlist_tracks mpt
    WHERE mpt.playlist_id = _managed_playlist_id
    ORDER BY mpt.position
  ),
  candidates AS (
    SELECT
      o.pos AS slot,
      (LAG(o.is_catalog) OVER (ORDER BY o.pos)) AS prev_is_catalog,
      o.is_catalog AS next_is_catalog
    FROM ordered o
    UNION ALL
    SELECT
      v_track_count AS slot,
      (SELECT o2.is_catalog FROM ordered o2 ORDER BY o2.pos DESC LIMIT 1) AS prev_is_catalog,
      NULL::BOOLEAN AS next_is_catalog
  )
  SELECT c.slot INTO v_slot
  FROM candidates c
  WHERE c.slot >= v_floor
    AND COALESCE(c.prev_is_catalog, FALSE) = FALSE
    AND COALESCE(c.next_is_catalog, FALSE) = FALSE
  ORDER BY c.slot ASC
  LIMIT 1;

  IF v_slot IS NULL THEN
    RETURN QUERY SELECT v_track_count,
      format('fallback_append floor=%s followers=%s campaign=%s tracks=%s',
        v_floor, v_followers, _is_campaign_active, v_track_count);
    RETURN;
  END IF;

  RETURN QUERY SELECT v_slot,
    format('pos=%s floor=%s followers=%s campaign=%s tracks=%s alt_ok',
      v_slot, v_floor, v_followers, _is_campaign_active, v_track_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_compute_catalog_target_position(UUID, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_compute_catalog_target_position(UUID, TEXT, BOOLEAN) TO authenticated;
