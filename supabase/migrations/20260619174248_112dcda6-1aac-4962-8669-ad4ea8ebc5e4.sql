
-- ============================================================
-- Fase 15.1 — Blindagem operacional definitiva da campanha
-- ============================================================
-- Estratégia:
--   * Triggers de guarda bloqueiam edição de colunas críticas
--     APENAS quando o caller é JWT authenticated/anon.
--   * RPCs SECURITY DEFINER rodam como owner (postgres) e
--     passam pelas guardas naturalmente.
--   * service_role (cron / edge functions admin) também passa,
--     pra não quebrar processos internos hoje existentes.
-- ============================================================

-- ----------------------------------------------------------------
-- 1) Guard helper: detecta caller user-side
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._is_user_jwt_caller()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(auth.role(), '') IN ('authenticated', 'anon');
$$;

-- ----------------------------------------------------------------
-- 2) Trigger BEFORE UPDATE — campos críticos
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_campaign_critical_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Internal paths (postgres / service_role / trigger functions
  -- rodando como owner) sempre passam.
  IF NOT public._is_user_jwt_caller() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION
      'campaign_status_locked: use RPC oficial (activate/pause/resume/cancel/close). De % para %',
      OLD.status, NEW.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.plan_approved_at IS DISTINCT FROM OLD.plan_approved_at THEN
    RAISE EXCEPTION 'plan_approved_at_locked: use approve_campaign()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.client_approved_at IS DISTINCT FROM OLD.client_approved_at THEN
    RAISE EXCEPTION 'client_approved_at_locked: use client_approve_campaign()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.baseline_status IS DISTINCT FROM OLD.baseline_status THEN
    RAISE EXCEPTION 'baseline_status_locked: use capture_baseline()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.baseline_captured_at IS DISTINCT FROM OLD.baseline_captured_at THEN
    RAISE EXCEPTION 'baseline_captured_at_locked: use capture_baseline()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.plan_approved_at IS NOT NULL
     AND NEW.valor_cobrado IS DISTINCT FROM OLD.valor_cobrado THEN
    RAISE EXCEPTION
      'valor_cobrado_locked_after_approval: use set_campaign_price() — só admin pode ajustar após aprovação'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzz_guard_campaign_critical_fields ON public.campaigns;
CREATE TRIGGER zzz_guard_campaign_critical_fields
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_critical_fields();

-- ----------------------------------------------------------------
-- 3) Trigger BEFORE DELETE
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_campaign_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deals int;
  v_allocs int;
  v_externals int;
BEGIN
  IF NOT public._is_user_jwt_caller() THEN
    RETURN OLD;
  END IF;

  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'campaign_delete_blocked: apenas campanhas em rascunho podem ser apagadas (status=%)', OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.plan_approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'campaign_delete_blocked: plano já aprovado'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.baseline_captured_at IS NOT NULL OR OLD.baseline_status <> 'pending' THEN
    RAISE EXCEPTION 'campaign_delete_blocked: baseline já capturada'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(OLD.total_delivered, 0) > 0 THEN
    RAISE EXCEPTION 'campaign_delete_blocked: campanha tem entregas registradas'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*) INTO v_deals FROM public.curator_deals WHERE campaign_id = OLD.id;
  IF v_deals > 0 THEN
    RAISE EXCEPTION 'campaign_delete_blocked: campanha tem % deal(s) vinculado(s)', v_deals
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO v_allocs FROM public.campaign_eco_allocations WHERE campaign_id = OLD.id;
  IF v_allocs > 0 THEN
    RAISE EXCEPTION 'campaign_delete_blocked: campanha tem % alocação(ões) de ecossistema', v_allocs
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO v_externals FROM public.campaign_external_packages WHERE campaign_id = OLD.id;
  IF v_externals > 0 THEN
    RAISE EXCEPTION 'campaign_delete_blocked: campanha tem % pacote(s) externo(s)', v_externals
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS zzz_guard_campaign_delete ON public.campaigns;
CREATE TRIGGER zzz_guard_campaign_delete
  BEFORE DELETE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_delete();

-- ----------------------------------------------------------------
-- 4) Remove auto-complete por trigger
--    Substituído por close_campaign() chamado pelo cron edge.
-- ----------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_auto_complete_campaign_on_goal ON public.campaigns;
-- A função fica no esquema (idempotente) — só removemos o gatilho.

-- ----------------------------------------------------------------
-- 5) Proteção dos uploads de baseline (APP-03)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_baseline_upload_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._is_user_jwt_caller() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF COALESCE(OLD.is_baseline, false) THEN
      RAISE EXCEPTION 'baseline_upload_locked: uploads de baseline não podem ser apagados'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: bloqueia se OLD ou NEW é baseline (qualquer edição em registro baseline)
  IF COALESCE(OLD.is_baseline, false) THEN
    RAISE EXCEPTION 'baseline_upload_locked: uploads de baseline são imutáveis'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Bloqueia também marcar um upload comum como baseline pelo client.
  IF COALESCE(NEW.is_baseline, false) AND NOT COALESCE(OLD.is_baseline, false) THEN
    RAISE EXCEPTION 'baseline_upload_locked: marcar como baseline é responsabilidade de capture_baseline()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzz_guard_baseline_upload_update ON public.label_spreadsheet_uploads;
CREATE TRIGGER zzz_guard_baseline_upload_update
  BEFORE UPDATE ON public.label_spreadsheet_uploads
  FOR EACH ROW EXECUTE FUNCTION public.guard_baseline_upload_mutation();

DROP TRIGGER IF EXISTS zzz_guard_baseline_upload_delete ON public.label_spreadsheet_uploads;
CREATE TRIGGER zzz_guard_baseline_upload_delete
  BEFORE DELETE ON public.label_spreadsheet_uploads
  FOR EACH ROW EXECUTE FUNCTION public.guard_baseline_upload_mutation();

-- ============================================================
-- 6) RPCs OFICIAIS — único caminho legítimo de transição
-- ============================================================

-- Helper: valida pré-requisitos de ativação. Retorna NULL se ok,
-- ou texto com motivo do bloqueio.
CREATE OR REPLACE FUNCTION public._validate_campaign_activation(c public.campaigns)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_has_alloc boolean;
BEGIN
  IF c.client_approved_at IS NULL THEN RETURN 'client_approval_required'; END IF;
  IF c.plan_approved_at   IS NULL THEN RETURN 'plan_approval_required';   END IF;
  IF c.valor_cobrado IS NULL OR c.valor_cobrado <= 0 THEN
    RETURN 'valor_cobrado_required';
  END IF;
  IF c.baseline_status <> 'captured' OR c.baseline_captured_at IS NULL THEN
    RETURN 'baseline_required';
  END IF;
  IF c.status = 'cancelled' THEN RETURN 'campaign_cancelled'; END IF;
  IF c.status = 'completed' THEN RETURN 'campaign_closed';    END IF;
  SELECT EXISTS(SELECT 1 FROM public.campaign_eco_allocations WHERE campaign_id = c.id) INTO v_has_alloc;
  IF NOT v_has_alloc THEN RETURN 'no_allocations'; END IF;
  RETURN NULL;
END;
$$;

-- 6.1 activate_campaign
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

-- 6.2 pause_campaign
CREATE OR REPLACE FUNCTION public.pause_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_c public.campaigns%ROWTYPE;
BEGIN
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

-- 6.3 resume_campaign — mesma validação de activate
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

-- 6.4 cancel_campaign
CREATE OR REPLACE FUNCTION public.cancel_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_c public.campaigns%ROWTYPE;
BEGIN
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

-- 6.5 close_campaign — encerramento com validações de pendência
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
  v_batches_pending int;
BEGIN
  IF NOT public.has_team_access() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_c FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF v_c.status IN ('completed','cancelled') THEN
    RETURN jsonb_build_object('ok', true, 'already_closed', true, 'status', v_c.status);
  END IF;

  IF NOT p_force THEN
    -- uploads pendentes da label
    SELECT count(*) INTO v_uploads_pending
      FROM public.label_spreadsheet_uploads u
      JOIN public.curator_deals d ON d.id = u.deal_id
     WHERE d.campaign_id = p_campaign_id
       AND u.status IN ('pending','processing','queued');
    IF v_uploads_pending > 0 THEN
      RAISE EXCEPTION 'close_blocked: % upload(s) pendente(s)', v_uploads_pending
        USING ERRCODE = 'check_violation';
    END IF;

    -- prints em processamento
    SELECT count(*) INTO v_prints_processing
      FROM public.bot_print_batches b
      JOIN public.curator_deals d ON d.id = b.deal_id
     WHERE d.campaign_id = p_campaign_id
       AND b.status IN ('pending','processing','queued');
    IF v_prints_processing > 0 THEN
      RAISE EXCEPTION 'close_blocked: % print(s) em processamento', v_prints_processing
        USING ERRCODE = 'check_violation';
    END IF;

    -- curadores abertos
    SELECT count(*) INTO v_open_deals
      FROM public.curator_deals
     WHERE campaign_id = p_campaign_id
       AND COALESCE(state,'active') NOT IN ('closed','completed','cancelled');
    IF v_open_deals > 0 THEN
      RAISE EXCEPTION 'close_blocked: % deal(s) de curador em aberto', v_open_deals
        USING ERRCODE = 'check_violation';
    END IF;

    -- fila do bot ativa
    SELECT count(*) INTO v_queue_active
      FROM public.playlist_execution_jobs j
      JOIN public.campaign_eco_allocations a ON a.id = j.allocation_id
     WHERE a.campaign_id = p_campaign_id
       AND j.status IN ('pending','running','queued');
    IF v_queue_active > 0 THEN
      RAISE EXCEPTION 'close_blocked: % job(s) ativo(s) na fila', v_queue_active
        USING ERRCODE = 'check_violation';
    END IF;

    -- batches pendentes (snapshot queue)
    SELECT count(*) INTO v_batches_pending
      FROM public.catalog_snapshot_queue q
     WHERE q.campaign_id = p_campaign_id
       AND q.status IN ('pending','processing','queued');
    IF v_batches_pending > 0 THEN
      RAISE EXCEPTION 'close_blocked: % batch(es) pendente(s)', v_batches_pending
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.campaigns
     SET status = 'completed',
         closed_at = COALESCE(closed_at, now())
   WHERE id = p_campaign_id;
  RETURN jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'status', 'completed', 'forced', p_force);
END;
$$;

-- 6.6 approve_campaign — substitui a antiga
-- Mantém compat com chamadas existentes (mesma assinatura).
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
  IF NOT public.has_team_access() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_c FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF v_c.client_approved_at IS NULL THEN
    RAISE EXCEPTION 'client_approval_required';
  END IF;
  IF v_c.plan_approved_at IS NULL THEN
    RAISE EXCEPTION 'plan_approval_required';
  END IF;
  IF v_c.valor_cobrado IS NULL OR v_c.valor_cobrado <= 0 THEN
    RAISE EXCEPTION 'valor_cobrado_required';
  END IF;
  IF v_c.status NOT IN ('draft','paused') THEN
    RAISE EXCEPTION 'campaign_not_in_approvable_state: %', v_c.status;
  END IF;
  IF v_c.curator_id IS NULL THEN
    RAISE EXCEPTION 'curator_required';
  END IF;

  IF v_c.collection_mode = 'spreadsheet' AND v_c.deal_id IS NOT NULL THEN
    SELECT count(*) INTO v_baseline_count
      FROM public.label_spreadsheet_uploads
     WHERE deal_id = v_c.deal_id AND is_baseline = true AND status = 'done';
    IF v_baseline_count = 0 THEN
      RAISE EXCEPTION 'baseline_required';
    END IF;
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

  RETURN jsonb_build_object(
    'ok', true,
    'campaign_id', p_campaign_id,
    'deal_id', v_deal_id,
    'reused_existing_deal', (v_c.deal_id IS NOT NULL)
  );
END;
$$;

-- 6.7 capture_baseline — execução única
CREATE OR REPLACE FUNCTION public.capture_baseline(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_c public.campaigns%ROWTYPE;
BEGIN
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

-- 6.8 set_campaign_price
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

-- 6.9 delete_campaign
CREATE OR REPLACE FUNCTION public.delete_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_team_access() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM public.campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  RETURN jsonb_build_object('ok', true, 'campaign_id', p_campaign_id);
END;
$$;

-- 6.10 get_campaign_capabilities — informa o frontend o que pode fazer
CREATE OR REPLACE FUNCTION public.get_campaign_capabilities(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c public.campaigns%ROWTYPE;
  v_reason text;
  v_can_activate boolean := false;
  v_can_pause boolean := false;
  v_can_resume boolean := false;
  v_can_cancel boolean := false;
  v_can_close boolean := false;
  v_can_delete boolean := false;
  v_can_set_price boolean := false;
  v_reasons jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_c FROM public.campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'campaign_not_found'); END IF;

  v_reason := public._validate_campaign_activation(v_c);
  v_can_activate := (v_c.status = 'draft' AND v_reason IS NULL);
  IF v_c.status = 'draft' AND v_reason IS NOT NULL THEN
    v_reasons := v_reasons || jsonb_build_object('activate', v_reason);
  END IF;
  v_can_resume := (v_c.status = 'paused' AND v_reason IS NULL);
  IF v_c.status = 'paused' AND v_reason IS NOT NULL THEN
    v_reasons := v_reasons || jsonb_build_object('resume', v_reason);
  END IF;
  v_can_pause  := v_c.status IN ('active');
  v_can_cancel := v_c.status NOT IN ('completed','cancelled') AND COALESCE(v_c.total_delivered,0) = 0;
  IF v_c.status IN ('completed','cancelled') THEN
    v_reasons := v_reasons || jsonb_build_object('cancel', 'already_closed_or_cancelled');
  ELSIF COALESCE(v_c.total_delivered,0) > 0 THEN
    v_reasons := v_reasons || jsonb_build_object('cancel', 'has_deliveries');
  END IF;
  v_can_close := v_c.status NOT IN ('completed','cancelled','draft');
  v_can_delete := v_c.status = 'draft'
                  AND v_c.plan_approved_at IS NULL
                  AND v_c.baseline_captured_at IS NULL
                  AND COALESCE(v_c.total_delivered,0) = 0;
  v_can_set_price := v_c.plan_approved_at IS NULL
                  OR COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false);

  RETURN jsonb_build_object(
    'ok', true,
    'campaign_id', v_c.id,
    'status', v_c.status,
    'can_activate', v_can_activate,
    'can_pause',    v_can_pause,
    'can_resume',   v_can_resume,
    'can_cancel',   v_can_cancel,
    'can_close',    v_can_close,
    'can_delete',   v_can_delete,
    'can_set_price', v_can_set_price,
    'block_reasons', v_reasons
  );
END;
$$;

-- ============================================================
-- 7) GRANTs
-- ============================================================
REVOKE ALL ON FUNCTION public.activate_campaign(uuid)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pause_campaign(uuid)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resume_campaign(uuid)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_campaign(uuid)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_campaign(uuid, boolean)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_campaign(uuid)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.capture_baseline(uuid)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_campaign_price(uuid, numeric)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_campaign(uuid)                 FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.activate_campaign(uuid)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pause_campaign(uuid)               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resume_campaign(uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_campaign(uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_campaign(uuid, boolean)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_campaign(uuid)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capture_baseline(uuid)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_campaign_price(uuid, numeric)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_campaign(uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_campaign_capabilities(uuid)    TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.activate_campaign(uuid) IS 'Fase 15 — único caminho legítimo para ativar campanha.';
COMMENT ON FUNCTION public.close_campaign(uuid, boolean) IS 'Fase 15 — substitui UPDATE status=completed. p_force=true só para admin.';
