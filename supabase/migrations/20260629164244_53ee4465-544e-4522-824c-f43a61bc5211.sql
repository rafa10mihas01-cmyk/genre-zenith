CREATE OR REPLACE FUNCTION public.client_approve_campaign(p_token text, p_approver_name text, p_approver_ip text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign_id uuid;
  v_status text;
  v_track text;
  v_artist text;
  v_round int;
BEGIN
  IF p_approver_name IS NULL OR length(trim(p_approver_name)) < 2 THEN
    RAISE EXCEPTION 'approver_name_required';
  END IF;

  -- O cliente aprova ANTES da aprovação interna do plano.
  -- Portanto, plan_approved_at NÃO pode bloquear o portal do cliente.
  SELECT id, status
    INTO v_campaign_id, v_status
    FROM public.campaigns
   WHERE public_plan_token = p_token
   FOR UPDATE;

  IF v_campaign_id IS NULL THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  IF v_status IN ('cancelled','completed') THEN
    RAISE EXCEPTION 'campaign_not_approvable: status=%', v_status;
  END IF;

  UPDATE public.campaigns
     SET client_approved_at = now(),
         client_approved_by = trim(p_approver_name),
         client_approved_ip = p_approver_ip,
         client_rejected_at = NULL,
         client_adjustment_request = NULL
   WHERE id = v_campaign_id AND client_approved_at IS NULL
  RETURNING track_name, artist, client_decision_round
       INTO v_track, v_artist, v_round;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'already_approved';
  END IF;

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
        'domain','campanhas','kind','campaign_plan_decision',
        'decision','approved','campaign_id',v_campaign_id,'round',v_round,
        'dedupe_key','campaign_plan_decision:' || v_campaign_id::text || ':approved:' || v_round
      ),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_campaign_id;
END;
$function$;