
-- =========================================================================
-- 1) v_playlist_track_origin — incluir campanhas 'paused' além de 'active'
-- =========================================================================
CREATE OR REPLACE VIEW public.v_playlist_track_origin AS
WITH base AS (
  SELECT mpt.playlist_id AS managed_playlist_id,
         mpt.spotify_track_id,
         mpt."position"
    FROM public.managed_playlist_tracks mpt
),
camp AS (
  SELECT DISTINCT mp.id AS managed_playlist_id,
         c.spotify_track_id,
         (array_agg(c.id))[1] AS campaign_id
    FROM public.campaigns c
    JOIN public.campaign_playlist_collections cpc ON cpc.campaign_id = c.id
    JOIN public.managed_playlists mp ON mp.spotify_playlist_id = cpc.playlist_id
   WHERE c.status IN ('active','paused')
     AND c.spotify_track_id IS NOT NULL
   GROUP BY mp.id, c.spotify_track_id
),
cat AS (
  SELECT DISTINCT cp.managed_playlist_id,
         ct.spotify_track_id
    FROM public.catalog_placements cp
    JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id
   WHERE cp.status = 'active'
)
SELECT b.managed_playlist_id,
       b.spotify_track_id,
       b."position",
       CASE
         WHEN c.spotify_track_id  IS NOT NULL THEN 'Campaign'
         WHEN ca.spotify_track_id IS NOT NULL THEN 'Catalog'
         ELSE 'ThirdParty'
       END AS origin,
       c.campaign_id
  FROM base b
  LEFT JOIN camp c  ON c.managed_playlist_id = b.managed_playlist_id
                   AND c.spotify_track_id    = b.spotify_track_id
  LEFT JOIN cat ca  ON ca.managed_playlist_id = b.managed_playlist_id
                   AND ca.spotify_track_id    = b.spotify_track_id;

-- =========================================================================
-- 2) fn_compute_catalog_target_position — excluir slots ocupados por campanha
-- =========================================================================
-- Um INSERT em position=X empurra a faixa que estava em X para X+1. Portanto,
-- se pos=X é uma faixa de campanha, esse slot NÃO pode ser candidato para
-- catálogo (deslocaria a campanha). O slot de append no final (v_track_count)
-- continua sempre válido — não desloca ninguém.
CREATE OR REPLACE FUNCTION public.fn_compute_catalog_target_position(
  _managed_playlist_id uuid,
  _spotify_track_id text,
  _is_campaign_active boolean
)
RETURNS TABLE(slot_position integer, reason text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_followers      BIGINT;
  v_track_count    INTEGER;
  v_floor          INTEGER;
  v_hot_zone       INTEGER := 5;
  v_hot_threshold  INTEGER := 5000;
  v_slot           INTEGER;
BEGIN
  SELECT COALESCE(mp.followers, 0) INTO v_followers
    FROM public.managed_playlists mp WHERE mp.id = _managed_playlist_id;

  SELECT COUNT(*)::INTEGER INTO v_track_count
    FROM public.managed_playlist_tracks mpt WHERE mpt.playlist_id = _managed_playlist_id;
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
        SELECT 1 FROM public.catalog_tracks ct
        WHERE ct.spotify_track_id = mpt.spotify_track_id
      ) AS is_catalog,
      EXISTS (
        SELECT 1 FROM public.v_playlist_track_origin o
        WHERE o.managed_playlist_id = _managed_playlist_id
          AND o.spotify_track_id    = mpt.spotify_track_id
          AND o.origin = 'Campaign'
      ) AS is_campaign
    FROM public.managed_playlist_tracks mpt
    WHERE mpt.playlist_id = _managed_playlist_id
    ORDER BY mpt.position
  ),
  candidates AS (
    SELECT
      o.pos AS slot,
      (LAG(o.is_catalog) OVER (ORDER BY o.pos)) AS prev_is_catalog,
      o.is_catalog  AS next_is_catalog,
      o.is_campaign AS next_is_campaign
    FROM ordered o
    UNION ALL
    SELECT
      v_track_count AS slot,
      (SELECT o2.is_catalog FROM ordered o2 ORDER BY o2.pos DESC LIMIT 1) AS prev_is_catalog,
      NULL::BOOLEAN AS next_is_catalog,
      FALSE         AS next_is_campaign
  )
  SELECT c.slot INTO v_slot
  FROM candidates c
  WHERE c.slot >= v_floor
    AND COALESCE(c.prev_is_catalog, FALSE) = FALSE
    AND COALESCE(c.next_is_catalog, FALSE) = FALSE
    AND COALESCE(c.next_is_campaign, FALSE) = FALSE  -- não desloca campanha
  ORDER BY c.slot ASC
  LIMIT 1;

  IF v_slot IS NULL THEN
    -- Fallback: append no final (não desloca ninguém, seguro pra campanha).
    RETURN QUERY SELECT v_track_count,
      format('fallback_append floor=%s followers=%s campaign=%s tracks=%s',
        v_floor, v_followers, _is_campaign_active, v_track_count);
    RETURN;
  END IF;

  RETURN QUERY SELECT v_slot,
    format('pos=%s floor=%s followers=%s campaign=%s tracks=%s alt_ok camp_ok',
      v_slot, v_floor, v_followers, _is_campaign_active, v_track_count);
END;
$function$;

-- =========================================================================
-- 3) fn_decide_placement_action — rotular "campaign_protected" quando
--    não há vítima ThirdParty mas há faixa de campanha na playlist.
--    (Apenas observabilidade — a exclusão do 'Campaign' da vítima já existia.)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.fn_decide_placement_action(p_placement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_cp record;
  v_mp record;
  v_ct record;
  v_owner_app_id uuid;
  v_owner_has_token boolean := false;
  v_breaker_open boolean := false;
  v_current_count integer := 0;
  v_planned_ceiling integer := 150;
  v_victim_track text;
  v_has_campaign  boolean := false;
BEGIN
  SELECT cp.id, cp.status, cp.catalog_track_id, cp.managed_playlist_id
    INTO v_cp
  FROM public.catalog_placements cp WHERE cp.id = p_placement_id;
  IF v_cp.id IS NULL THEN
    RETURN jsonb_build_object('action','SKIP','reason','placement_not_found');
  END IF;
  IF v_cp.status NOT IN ('pending','processing','retry','skipped','waiting_circuit_breaker') THEN
    RETURN jsonb_build_object('action','SKIP','reason','status_not_executable:'||v_cp.status);
  END IF;

  SELECT ct.id, ct.spotify_track_id INTO v_ct
  FROM public.catalog_tracks ct WHERE ct.id = v_cp.catalog_track_id;
  IF v_ct.id IS NULL OR v_ct.spotify_track_id IS NULL OR v_ct.spotify_track_id = '' THEN
    RETURN jsonb_build_object('action','SKIP','reason','no_track_id');
  END IF;

  SELECT mp.id, mp.spotify_playlist_id, mp.playlist_type, mp.execution_mode,
         mp.operational_status, mp.genre_id, mp.owner_spotify_user_id
    INTO v_mp
  FROM public.managed_playlists mp WHERE mp.id = v_cp.managed_playlist_id;
  IF v_mp.id IS NULL THEN
    RETURN jsonb_build_object('action','SKIP','reason','playlist_not_found');
  END IF;
  IF v_mp.playlist_type = 'ARCHIVED'::public.playlist_type_enum THEN
    RETURN jsonb_build_object('action','SKIP','reason','playlist_archived');
  END IF;
  IF v_mp.spotify_playlist_id IS NULL OR v_mp.spotify_playlist_id = '' THEN
    RETURN jsonb_build_object('action','SKIP','reason','no_spotify_id');
  END IF;
  IF v_mp.execution_mode = 'MANUAL_ONLY'::playlist_execution_mode THEN
    RETURN jsonb_build_object('action','SKIP','reason','manual_only');
  END IF;
  IF v_mp.execution_mode = 'DISABLED'::playlist_execution_mode THEN
    RETURN jsonb_build_object('action','SKIP','reason','disabled');
  END IF;
  IF COALESCE(v_mp.operational_status,'') = 'do_not_operate' THEN
    RETURN jsonb_build_object('action','SKIP','reason','do_not_operate');
  END IF;

  IF v_mp.owner_spotify_user_id IS NOT NULL THEN
    SELECT sut.app_id INTO v_owner_app_id
    FROM public.spotify_user_tokens sut
    WHERE sut.spotify_user_id = v_mp.owner_spotify_user_id
    ORDER BY sut.is_default DESC NULLS LAST, sut.updated_at DESC NULLS LAST
    LIMIT 1;

    IF v_owner_app_id IS NOT NULL THEN
      v_owner_has_token := true;
      PERFORM 1 FROM public.spotify_circuit_breaker scb
      WHERE scb.app_id = v_owner_app_id::text
        AND scb.context = 'operation'
        AND scb.status = 'open'
        AND (scb.blocked_until IS NULL OR scb.blocked_until > now())
      LIMIT 1;
      IF FOUND THEN v_breaker_open := true; END IF;
    END IF;

    IF NOT v_owner_has_token THEN
      RETURN jsonb_build_object('action','SKIP','reason','no_oauth_token');
    END IF;
    IF v_breaker_open THEN
      RETURN jsonb_build_object('action','SKIP','reason','circuit_open');
    END IF;
  END IF;

  PERFORM 1 FROM public.managed_playlist_tracks mpt
  WHERE mpt.playlist_id = v_mp.id AND mpt.spotify_track_id = v_ct.spotify_track_id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('action','SKIP','reason','already_present');
  END IF;

  SELECT COUNT(*) INTO v_current_count
  FROM public.managed_playlist_tracks mpt WHERE mpt.playlist_id = v_mp.id;

  SELECT COALESCE(fp.operational_ceiling, 150) INTO v_planned_ceiling
  FROM public.fn_resolve_playlist_policy(v_mp.id) fp;

  IF v_current_count < v_planned_ceiling THEN
    RETURN jsonb_build_object('action','INSERT');
  END IF;

  SELECT mpt.spotify_track_id INTO v_victim_track
  FROM public.managed_playlist_tracks mpt
  LEFT JOIN public.v_playlist_track_origin o
    ON o.managed_playlist_id = mpt.playlist_id
   AND o.spotify_track_id   = mpt.spotify_track_id
  WHERE mpt.playlist_id = v_mp.id
    AND COALESCE(o.origin, 'ThirdParty') = 'ThirdParty'
  ORDER BY mpt.position DESC NULLS LAST
  LIMIT 1;

  IF v_victim_track IS NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.v_playlist_track_origin o
      WHERE o.managed_playlist_id = v_mp.id
        AND o.origin = 'Campaign'
    ) INTO v_has_campaign;

    IF v_has_campaign THEN
      RETURN jsonb_build_object('action','SKIP','reason','no_capacity_campaign_protected');
    END IF;
    RETURN jsonb_build_object('action','SKIP','reason','no_capacity_no_victim');
  END IF;

  RETURN jsonb_build_object('action','REMOVE_INSERT','remove_track_id', v_victim_track);
END;
$function$;
