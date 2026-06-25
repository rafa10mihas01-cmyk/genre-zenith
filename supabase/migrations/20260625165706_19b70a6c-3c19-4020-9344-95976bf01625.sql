
CREATE OR REPLACE FUNCTION public.fn_playlist_occupancy_rebuild(
  p_playlist_id uuid,
  p_mode text DEFAULT 'SHADOW'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
  v_policy record;
  v_policy_src text;
  v_total_current integer := 0;
  v_third_count integer := 0;
  v_third_cap integer := 0;
  v_campaign_count integer := 0;
  v_dup_removed integer := 0;
  v_third_overflow integer := 0;
  v_inserts integer := 0;
  v_repos integer := 0;
BEGIN
  IF p_mode NOT IN ('SHADOW','PRIMARY') THEN
    RAISE EXCEPTION 'invalid mode: %', p_mode;
  END IF;

  SELECT * INTO v_policy FROM public.fn_resolve_playlist_policy(p_playlist_id);
  IF v_policy IS NULL OR v_policy.managed_playlist_id IS NULL THEN
    RAISE EXCEPTION 'playlist % não encontrada', p_playlist_id;
  END IF;
  v_policy_src := v_policy.source;

  INSERT INTO public.occupancy_plans (managed_playlist_id, mode, status, policy_snapshot)
  VALUES (
    p_playlist_id, p_mode,
    CASE WHEN v_policy_src = 'missing' THEN 'blocked' ELSE 'draft' END,
    to_jsonb(v_policy)
  ) RETURNING id INTO v_plan_id;

  IF v_policy_src = 'missing' THEN
    UPDATE public.occupancy_plans SET block_reason='policy_missing', finalized_at=now() WHERE id=v_plan_id;
    INSERT INTO public.playlist_policy_alerts (managed_playlist_id, alert_type, severity, message, details)
    VALUES (p_playlist_id, 'policy_missing', 'warning',
            'Playlist sem política editorial; rebalanceamento bloqueado.',
            jsonb_build_object('plan_id', v_plan_id));
    RETURN v_plan_id;
  END IF;

  DROP TABLE IF EXISTS _cur;
  CREATE TEMP TABLE _cur ON COMMIT DROP AS
  SELECT
    mpt.spotify_track_id,
    mpt.position,
    COALESCE(o.origin, 'ThirdParty') AS origin,
    ROW_NUMBER() OVER (PARTITION BY mpt.spotify_track_id ORDER BY mpt.position NULLS LAST) AS dup_rank
  FROM public.managed_playlist_tracks mpt
  LEFT JOIN public.v_playlist_track_origin o
    ON o.managed_playlist_id = mpt.playlist_id
   AND o.spotify_track_id   = mpt.spotify_track_id
  WHERE mpt.playlist_id = p_playlist_id;

  SELECT count(*) INTO v_total_current FROM _cur;
  SELECT count(*) INTO v_campaign_count FROM _cur WHERE origin='Campaign' AND dup_rank=1;
  SELECT count(*) INTO v_third_count FROM _cur WHERE origin='ThirdParty' AND dup_rank=1;
  v_third_cap := floor(GREATEST(v_total_current,1) * v_policy.third_party_max_pct / 100.0);

  -- OP1: dedupe
  INSERT INTO public.occupancy_plan_ops (plan_id, op_type, spotify_track_id, classification, from_position, reason)
  SELECT v_plan_id, 'REMOVE', spotify_track_id, origin, position, 'dedupe_intra_playlist'
  FROM _cur WHERE dup_rank > 1;
  GET DIAGNOSTICS v_dup_removed = ROW_COUNT;

  -- OP2: REPOSITION para proteger top-N (Campaign)
  INSERT INTO public.occupancy_plan_ops (plan_id, op_type, spotify_track_id, classification, from_position, to_position, reason)
  SELECT v_plan_id, 'REPOSITION', cb.spotify_track_id, 'Campaign', cb.position, nc.position, 'protect_top_n_campaign'
  FROM (
    SELECT spotify_track_id, position, ROW_NUMBER() OVER (ORDER BY position) rn
      FROM _cur WHERE dup_rank=1 AND origin='Campaign' AND position > v_policy.protect_top_n
  ) cb
  JOIN (
    SELECT position, ROW_NUMBER() OVER (ORDER BY position) rn
      FROM _cur WHERE dup_rank=1 AND origin <> 'Campaign' AND position <= v_policy.protect_top_n
  ) nc ON nc.rn = cb.rn;
  GET DIAGNOSTICS v_repos = ROW_COUNT;

  -- OP3: INSERT catálogo nos slots livres
  IF v_total_current < (v_policy.campaign_reserved_slots + v_policy.catalog_capacity) THEN
    WITH livres AS (
      SELECT (v_policy.campaign_reserved_slots + v_policy.catalog_capacity) - v_total_current AS qtd
    ),
    candidatos AS (
      SELECT ct.spotify_track_id
        FROM public.catalog_placements cp
        JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id
       WHERE cp.managed_playlist_id = p_playlist_id
         AND cp.status = 'active'
         AND ct.spotify_track_id NOT IN (SELECT spotify_track_id FROM _cur WHERE dup_rank=1)
       LIMIT (SELECT qtd FROM livres)
    )
    INSERT INTO public.occupancy_plan_ops (plan_id, op_type, spotify_track_id, classification, to_position, reason)
    SELECT v_plan_id, 'INSERT', spotify_track_id, 'Catalog',
           v_total_current + ROW_NUMBER() OVER (), 'fill_free_slot'
    FROM candidatos;
    GET DIAGNOSTICS v_inserts = ROW_COUNT;
  END IF;

  -- OP4: REMOVE excedente de terceiros (gradual - E3)
  IF v_third_count > v_third_cap THEN
    v_third_overflow := v_third_count - v_third_cap;
    INSERT INTO public.occupancy_plan_ops (plan_id, op_type, spotify_track_id, classification, from_position, reason)
    SELECT v_plan_id, 'REMOVE', spotify_track_id, 'ThirdParty', position, 'third_party_overflow_gradual'
    FROM (
      SELECT spotify_track_id, position FROM _cur
      WHERE dup_rank=1 AND origin='ThirdParty'
      ORDER BY position DESC
      LIMIT GREATEST(1, ceil(v_third_overflow::numeric / 4.0)::int)
    ) z;
  END IF;

  UPDATE public.occupancy_plans
     SET status='ready', finalized_at=now(),
         stats = jsonb_build_object(
           'total_current', v_total_current,
           'campaign_count', v_campaign_count,
           'third_party_count', v_third_count,
           'third_party_cap', v_third_cap,
           'third_party_overflow', v_third_overflow,
           'duplicates_removed', v_dup_removed,
           'campaign_repositions', v_repos,
           'catalog_inserts', v_inserts
         )
   WHERE id = v_plan_id;

  RETURN v_plan_id;
END;
$$;
