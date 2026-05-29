-- Onda 1 do plano de correção
-- G4: contador de rodada de decisão do cliente
-- G3: notificações internas quando cliente aprova ou pede ajuste

-- 1) Coluna additiva pra contar quantas vezes o cliente já decidiu sobre o plano.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS client_decision_round int NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.campaigns.client_decision_round IS
  'Quantas rodadas de decisão do cliente já aconteceram. Começa em 1, incrementa a cada client_request_adjustment.';

-- 2) client_approve_campaign — adiciona insert em notifications (broadcast pro time)
CREATE OR REPLACE FUNCTION public.client_approve_campaign(p_token text, p_approver_name text, p_approver_ip text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign_id uuid;
  v_track text;
  v_artist text;
  v_round int;
BEGIN
  IF p_approver_name IS NULL OR length(trim(p_approver_name)) < 2 THEN
    RAISE EXCEPTION 'approver_name_required';
  END IF;
  UPDATE public.campaigns
     SET client_approved_at = now(),
         client_approved_by = trim(p_approver_name),
         client_approved_ip = p_approver_ip,
         client_rejected_at = NULL,
         client_adjustment_request = NULL
   WHERE public_plan_token = p_token AND client_approved_at IS NULL
  RETURNING id, track_name, artist, client_decision_round
       INTO v_campaign_id, v_track, v_artist, v_round;
  IF v_campaign_id IS NULL THEN
    RAISE EXCEPTION 'invalid_token_or_already_approved';
  END IF;

  -- G3: broadcast pro time interno (user_id NULL = todos operadores via policy)
  BEGIN
    INSERT INTO public.notifications (type, title, message, action_url, metadata, user_id)
    VALUES (
      'info',
      'Cliente aprovou o plano',
      COALESCE(v_track, 'Campanha') || COALESCE(' — ' || v_artist, '') ||
        ' aprovado por ' || trim(p_approver_name) ||
        CASE WHEN v_round > 1 THEN ' (rodada ' || v_round || ')' ELSE '' END,
      '/campanhas/' || v_campaign_id::text,
      jsonb_build_object(
        'domain', 'campanhas',
        'kind', 'campaign_plan_decision',
        'decision', 'approved',
        'campaign_id', v_campaign_id,
        'round', v_round,
        'dedupe_key', 'campaign_plan_decision:' || v_campaign_id::text || ':approved:' || v_round
      ),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    -- Notification é best-effort; nunca derruba aprovação.
    NULL;
  END;

  RETURN v_campaign_id;
END; $function$;

-- 3) client_request_adjustment — incrementa round + insert em notifications
CREATE OR REPLACE FUNCTION public.client_request_adjustment(p_token text, p_message text, p_requester_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign_id uuid;
  v_camp record;
  v_next_version int;
  v_allocs jsonb;
  v_new_round int;
BEGIN
  IF p_message IS NULL OR length(trim(p_message)) < 3 THEN
    RAISE EXCEPTION 'message_required';
  END IF;

  SELECT id, simulation_snapshot, goal_plays, total_allocated, valor_cobrado, engagement_multiplier, eco_max_pct,
         track_name, artist, client_decision_round
    INTO v_camp
    FROM public.campaigns
   WHERE public_plan_token = p_token;
  IF v_camp.id IS NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
    FROM public.campaign_plan_versions WHERE campaign_id = v_camp.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'playlist_id', playlist_id,
           'target_plays', target_plays,
           'weight', weight,
           'delivered_plays', delivered_plays,
           'status', status,
           'position', position
         ) ORDER BY position), '[]'::jsonb)
    INTO v_allocs
    FROM public.campaign_allocations WHERE campaign_id = v_camp.id;

  INSERT INTO public.campaign_plan_versions
    (campaign_id, version, snapshot, goal_plays, total_allocated, valor_cobrado, requested_message, requested_by)
  VALUES
    (v_camp.id, v_next_version,
     jsonb_build_object(
       'simulation_snapshot', v_camp.simulation_snapshot,
       'allocations', v_allocs,
       'engagement_multiplier', v_camp.engagement_multiplier,
       'eco_max_pct', v_camp.eco_max_pct
     ),
     v_camp.goal_plays, v_camp.total_allocated, v_camp.valor_cobrado,
     trim(p_message), NULLIF(trim(COALESCE(p_requester_name,'')), ''));

  v_new_round := COALESCE(v_camp.client_decision_round, 1) + 1;

  UPDATE public.campaigns
     SET client_rejected_at = now(),
         client_adjustment_request = trim(p_message),
         client_approved_at = NULL,
         client_approved_by = COALESCE(trim(p_requester_name), client_approved_by),
         client_decision_round = v_new_round
   WHERE id = v_camp.id
   RETURNING id INTO v_campaign_id;

  -- G3: broadcast pro time
  BEGIN
    INSERT INTO public.notifications (type, title, message, action_url, metadata, user_id)
    VALUES (
      'warning',
      'Cliente pediu ajuste no plano',
      COALESCE(v_camp.track_name, 'Campanha') || COALESCE(' — ' || v_camp.artist, '') ||
        ' (rodada ' || v_new_round || ')' ||
        COALESCE(' · ' || NULLIF(trim(COALESCE(p_requester_name,'')), ''), ''),
      '/campanhas/' || v_campaign_id::text,
      jsonb_build_object(
        'domain', 'campanhas',
        'kind', 'campaign_plan_decision',
        'decision', 'adjustment_requested',
        'campaign_id', v_campaign_id,
        'round', v_new_round,
        'message', trim(p_message),
        'dedupe_key', 'campaign_plan_decision:' || v_campaign_id::text || ':adjustment:' || v_new_round
      ),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_campaign_id;
END;
$function$;