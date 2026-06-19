
-- ============================================================
-- Fase 15.1 — Correções Definitivas da Blindagem Operacional
-- ============================================================
-- 1) Session-context flag para RPCs canônicas bypassarem guards
-- 2) Fix close_campaign (remove referência inválida a q.campaign_id)
-- 3) approve_campaign_plan RPC (setter canônico do plan_approved_at)
-- ============================================================

-- ------------------------------------------------------------
-- 1) Bypass guard via session flag
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._is_user_jwt_caller()
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_op text;
BEGIN
  -- Operação canônica em curso: RPC SECURITY DEFINER setou a flag.
  -- Guards devem deixar passar.
  BEGIN
    v_op := current_setting('app.canonical_op', true);
  EXCEPTION WHEN OTHERS THEN
    v_op := NULL;
  END;
  IF v_op = 'true' THEN
    RETURN false;
  END IF;
  RETURN COALESCE(auth.role(), '') IN ('authenticated', 'anon');
END;
$$;

-- Helper interno: marca a transação atual como operação canônica.
-- Usado em todas as RPCs oficiais antes de qualquer UPDATE/INSERT/DELETE.
CREATE OR REPLACE FUNCTION public._begin_canonical_op()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.canonical_op', 'true', true); -- true = LOCAL (transação)
END;
$$;

-- ------------------------------------------------------------
-- 2) Recria RPCs canônicas marcando contexto canônico
-- ------------------------------------------------------------

-- activate_campaign
CREATE OR REPLACE FUNCTION public.activate_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c public.campaigns%ROWTYPE;
  v_reason text;
BEGIN
  PERFORM public._begin_canonical_op();
  IF NOT public.has_team_access() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_c FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF v_c.status NOT IN ('draft','paused') THEN
    RAISE EXCEPTION 'campaign_not_in_activatable_state: %', v_c.status;
  END IF;
  v_reason := public._validate_campaign_activation(v_c);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'activation_blocked: %', v_reason
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.campaigns
     SET status = 'active',
         eco_dispatched_at = COALESCE(eco_dispatched_at, now()),
         snapshot_locked_at = COALESCE(snapshot_locked_at, now())
   WHERE id = p_campaign_id;
  RETURN jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'status', 'active');
END;
$$;

-- pause_campaign
CREATE OR REPLACE FUNCTION public.pause_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_c public.campaigns%ROWTYPE;
BEGIN
  PERFORM public._begin_canonical_op();
  IF NOT public.has_team_access() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_c FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF v_c.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'pause_blocked: campanha em %', v_c.status;
  END IF;
  IF v_c.status = 'paused' THEN
    RETURN jsonb_build_object('ok', true, 'already_paused', true);
  END IF;
  UPDATE public.campaigns SET status = 'paused' WHERE id = p_campaign_id;
  RETURN jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'status', 'paused');
END;
$$;

-- resume_campaign
CREATE OR REPLACE FUNCTION public.resume_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c public.campaigns%ROWTYPE;
  v_reason text;
BEGIN
  PERFORM public._begin_canonical_op();
  IF NOT public.has_team_access() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_c FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF v_c.status <> 'paused' THEN
    RAISE EXCEPTION 'resume_blocked: campanha não está pausada (%)', v_c.status;
  END IF;
  v_reason := public._validate_campaign_activation(v_c);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'resume_blocked: %', v_reason
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.campaigns SET status = 'active' WHERE id = p_campaign_id;
  RETURN jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'status', 'active');
END;
$$;

-- cancel_campaign
CREATE OR REPLACE FUNCTION public.cancel_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_c public.campaigns%ROWTYPE;
BEGIN
  PERFORM public._begin_canonical_op();
  IF NOT public.has_team_access() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_c FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF v_c.status IN ('completed') THEN
    RAISE EXCEPTION 'cancel_blocked: campanha encerrada';
  END IF;
  IF COALESCE(v_c.total_delivered, 0) > 0 THEN
    RAISE EXCEPTION 'cancel_blocked: existem entregas consolidadas (%)', v_c.total_delivered;
  END IF;
  UPDATE public.campaigns SET status = 'cancelled' WHERE id = p_campaign_id;
  RETURN jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'status', 'cancelled');
END;
$$;

-- close_campaign — FIX SQL: snapshot_queue não tem campaign_id.
-- Liga via spotify_track_id da campanha (job único por faixa).
CREATE OR REPLACE FUNCTION public.close_campaign(p_campaign_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c public.campaigns%ROWTYPE;
  v_uploads_pending int;
  v_prints_processing int;
  v_open_deals int;
  v_queue_active int;
  v_snap_pending int;
BEGIN
  PERFORM public._begin_canonical_op();
  IF NOT public.has_team_access() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_c FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF v_c.status IN ('completed','cancelled') THEN
    RETURN jsonb_build_object('ok', true, 'already_closed', true, 'status', v_c.status);
  END IF;

  IF NOT p_force THEN
    SELECT count(*) INTO v_uploads_pending
      FROM public.label_spreadsheet_uploads u
      JOIN public.curator_deals d ON d.id = u.deal_id
     WHERE d.campaign_id = p_campaign_id
       AND u.status IN ('pending','processing','queued');
    IF v_uploads_pending > 0 THEN
      RAISE EXCEPTION 'close_blocked: % upload(s) pendente(s)', v_uploads_pending
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO v_prints_processing
      FROM public.bot_print_batches b
      JOIN public.curator_deals d ON d.id = b.deal_id
     WHERE d.campaign_id = p_campaign_id
       AND b.status IN ('pending','processing','queued');
    IF v_prints_processing > 0 THEN
      RAISE EXCEPTION 'close_blocked: % print(s) em processamento', v_prints_processing
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO v_open_deals
      FROM public.curator_deals
     WHERE campaign_id = p_campaign_id
       AND COALESCE(state,'active') NOT IN ('closed','completed','cancelled');
    IF v_open_deals > 0 THEN
      RAISE EXCEPTION 'close_blocked: % deal(s) de curador em aberto', v_open_deals
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO v_queue_active
      FROM public.playlist_execution_jobs j
      JOIN public.campaign_eco_allocations a ON a.id = j.allocation_id
     WHERE a.campaign_id = p_campaign_id
       AND j.status IN ('pending','running','queued');
    IF v_queue_active > 0 THEN
      RAISE EXCEPTION 'close_blocked: % job(s) ativo(s) na fila', v_queue_active
        USING ERRCODE = 'check_violation';
    END IF;

    -- Snapshot queue: liga via spotify_track_id da campanha
    IF v_c.spotify_track_id IS NOT NULL THEN
      SELECT count(*) INTO v_snap_pending
        FROM public.catalog_snapshot_queue q
       WHERE q.spotify_track_id = v_c.spotify_track_id
         AND q.status IN ('pending','processing','queued');
      IF v_snap_pending > 0 THEN
        RAISE EXCEPTION 'close_blocked: % snapshot(s) pendente(s)', v_snap_pending
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  UPDATE public.campaigns
     SET status = 'completed',
         closed_at = COALESCE(closed_at, now())
   WHERE id = p_campaign_id;
  RETURN jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'status', 'completed', 'forced', p_force);
END;
$$;

-- capture_baseline
CREATE OR REPLACE FUNCTION public.capture_baseline(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_c public.campaigns%ROWTYPE;
BEGIN
  PERFORM public._begin_canonical_op();
  IF NOT public.has_team_access() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_c FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF v_c.baseline_status = 'captured' OR v_c.baseline_captured_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_captured', true);
  END IF;
  UPDATE public.campaigns
     SET baseline_status = 'captured',
         baseline_captured_at = now()
   WHERE id = p_campaign_id;
  RETURN jsonb_build_object('ok', true, 'campaign_id', p_campaign_id);
END;
$$;

-- set_campaign_price
CREATE OR REPLACE FUNCTION public.set_campaign_price(p_campaign_id uuid, p_valor numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c public.campaigns%ROWTYPE;
  v_is_admin boolean;
BEGIN
  PERFORM public._begin_canonical_op();
  IF NOT public.has_team_access() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'valor_invalido';
  END IF;
  SELECT * INTO v_c FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF v_c.plan_approved_at IS NOT NULL THEN
    SELECT public.has_role(auth.uid(), 'admin'::public.app_role) INTO v_is_admin;
    IF NOT COALESCE(v_is_admin, false) THEN
      RAISE EXCEPTION 'price_locked_after_approval: apenas admin pode ajustar';
    END IF;
  END IF;
  UPDATE public.campaigns SET valor_cobrado = p_valor WHERE id = p_campaign_id;
  RETURN jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'valor_cobrado', p_valor);
END;
$$;

-- approve_campaign (admin step)
CREATE OR REPLACE FUNCTION public.approve_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c public.campaigns%ROWTYPE;
  v_deal_id uuid;
  v_baseline_count int;
BEGIN
  PERFORM public._begin_canonical_op();
  IF NOT public.has_team_access() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_c FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF v_c.client_approved_at IS NULL THEN RAISE EXCEPTION 'client_approval_required'; END IF;
  IF v_c.plan_approved_at IS NULL THEN RAISE EXCEPTION 'plan_approval_required'; END IF;
  IF v_c.valor_cobrado IS NULL OR v_c.valor_cobrado <= 0 THEN
    RAISE EXCEPTION 'valor_cobrado_required';
  END IF;
  IF v_c.status NOT IN ('draft','paused') THEN
    RAISE EXCEPTION 'campaign_not_in_approvable_state: %', v_c.status;
  END IF;
  IF v_c.curator_id IS NULL THEN RAISE EXCEPTION 'curator_required'; END IF;

  IF v_c.collection_mode = 'spreadsheet' AND v_c.deal_id IS NOT NULL THEN
    SELECT count(*) INTO v_baseline_count
      FROM public.label_spreadsheet_uploads
     WHERE deal_id = v_c.deal_id AND is_baseline = true AND status = 'done';
    IF v_baseline_count = 0 THEN RAISE EXCEPTION 'baseline_required'; END IF;
  END IF;

  v_deal_id := v_c.deal_id;
  IF v_deal_id IS NULL THEN
    INSERT INTO public.curator_deals (
      user_id, curator_id, curator_name,
      song_spotify_url, song_name, song_artist, song_cover_url,
      target_plays, started_at, campaign_id,
      state, collection_mode, origin
    )
    SELECT
      COALESCE(v_c.created_by, auth.uid()),
      v_c.curator_id,
      COALESCE(cu.name, 'Curador'),
      COALESCE(v_c.spotify_track_url, ''),
      v_c.track_name, v_c.artist, v_c.cover_url,
      v_c.goal_plays, now(), v_c.id,
      'active', COALESCE(v_c.collection_mode, 'bot'), 'campaign_internal'
    FROM public.curators cu WHERE cu.id = v_c.curator_id
    RETURNING id INTO v_deal_id;
  END IF;

  UPDATE public.campaigns
     SET status = 'active',
         deal_id = COALESCE(deal_id, v_deal_id),
         snapshot_locked_at = COALESCE(snapshot_locked_at, now()),
         eco_dispatched_at = COALESCE(eco_dispatched_at, now())
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'deal_id', v_deal_id);
END;
$$;

-- delete_campaign
CREATE OR REPLACE FUNCTION public.delete_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._begin_canonical_op();
  IF NOT public.has_team_access() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM public.campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  RETURN jsonb_build_object('ok', true, 'campaign_id', p_campaign_id);
END;
$$;

-- ------------------------------------------------------------
-- 3) approve_campaign_plan — setter canônico do plan_approved_at
--    (admin-only; impede deadlock no fluxo oficial)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_campaign_plan(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c public.campaigns%ROWTYPE;
  v_uid uuid;
  v_is_admin boolean;
BEGIN
  PERFORM public._begin_canonical_op();
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT public.has_role(v_uid, 'admin'::public.app_role) INTO v_is_admin;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_c FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF v_c.plan_approved_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_approved', true);
  END IF;
  IF v_c.client_approved_at IS NULL THEN RAISE EXCEPTION 'client_approval_required'; END IF;
  IF v_c.valor_cobrado IS NULL OR v_c.valor_cobrado <= 0 THEN
    RAISE EXCEPTION 'valor_cobrado_required';
  END IF;
  IF v_c.status NOT IN ('draft','paused') THEN
    RAISE EXCEPTION 'campaign_not_in_plan_approvable_state: %', v_c.status;
  END IF;
  UPDATE public.campaigns
     SET plan_approved_at = now(),
         plan_approved_by = v_uid
   WHERE id = p_campaign_id;
  RETURN jsonb_build_object('ok', true, 'campaign_id', p_campaign_id);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_campaign_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_campaign_plan(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.approve_campaign_plan(uuid)
  IS 'Fase 15.1 — setter canônico de plan_approved_at; admin-only; bypassa guard via app.canonical_op.';
COMMENT ON FUNCTION public._begin_canonical_op()
  IS 'Marca a transação atual como operação canônica para que os guard triggers permitam o UPDATE.';
