
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS final_report_url TEXT,
  ADD COLUMN IF NOT EXISTS final_report_requested_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.approve_campaign_plan_atomic(
  p_campaign_id UUID,
  p_user_id UUID,
  p_valor_cobrado NUMERIC DEFAULT NULL,
  p_position_updates JSONB DEFAULT '[]'::jsonb,
  p_new_allocs JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_owner UUID;
  v_already TIMESTAMPTZ;
  v_pos_count INT := 0;
  v_ins_count INT := 0;
  rec JSONB;
BEGIN
  SELECT created_by, plan_approved_at
    INTO v_owner, v_already
  FROM public.campaigns
  WHERE id = p_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_owner IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_already IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_approved', true);
  END IF;

  -- 1) Approve plan
  UPDATE public.campaigns
     SET plan_approved_at = v_now,
         plan_approved_by = p_user_id,
         valor_cobrado = COALESCE(valor_cobrado, p_valor_cobrado)
   WHERE id = p_campaign_id;

  -- 2) Backfill positions (only where NULL)
  IF jsonb_array_length(COALESCE(p_position_updates, '[]'::jsonb)) > 0 THEN
    FOR rec IN SELECT * FROM jsonb_array_elements(p_position_updates) LOOP
      UPDATE public.campaign_eco_allocations
         SET position = (rec->>'position')::INT
       WHERE id = (rec->>'id')::UUID
         AND position IS NULL;
      IF FOUND THEN v_pos_count := v_pos_count + 1; END IF;
    END LOOP;
  END IF;

  -- 3) Insert affinity allocations atomically
  IF jsonb_array_length(COALESCE(p_new_allocs, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.campaign_eco_allocations (
      campaign_id, managed_playlist_id, planned_streams, start_day,
      status, position, genre_source, genre_affinity_score
    )
    SELECT
      p_campaign_id,
      (r->>'managed_playlist_id')::UUID,
      (r->>'planned_streams')::INT,
      COALESCE((r->>'start_day')::INT, 1),
      COALESCE(r->>'status', 'pending'),
      (r->>'position')::INT,
      r->>'genre_source',
      NULLIF(r->>'genre_affinity_score', '')::NUMERIC
    FROM jsonb_array_elements(p_new_allocs) r;
    GET DIAGNOSTICS v_ins_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already_approved', false,
    'positions_backfilled', v_pos_count,
    'affinity_inserted', v_ins_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_campaign_plan_atomic(UUID, UUID, NUMERIC, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_campaign_plan_atomic(UUID, UUID, NUMERIC, JSONB, JSONB) TO authenticated, service_role;
