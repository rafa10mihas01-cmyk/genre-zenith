
CREATE TABLE public.campaign_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  version int NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  goal_plays bigint,
  total_allocated bigint,
  valor_cobrado numeric(12,2),
  requested_message text,
  requested_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, version)
);

GRANT SELECT ON public.campaign_plan_versions TO authenticated;
GRANT ALL ON public.campaign_plan_versions TO service_role;

CREATE INDEX idx_cpv_campaign ON public.campaign_plan_versions (campaign_id, version DESC);

ALTER TABLE public.campaign_plan_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can read plan versions"
  ON public.campaign_plan_versions FOR SELECT
  TO authenticated
  USING (true);

-- RPC público para o portal do cliente ler versões via token
CREATE OR REPLACE FUNCTION public.list_campaign_plan_versions_by_token(p_token text)
RETURNS TABLE (
  id uuid,
  version int,
  snapshot jsonb,
  goal_plays bigint,
  total_allocated bigint,
  valor_cobrado numeric,
  requested_message text,
  requested_by text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.id, v.version, v.snapshot, v.goal_plays, v.total_allocated, v.valor_cobrado,
         v.requested_message, v.requested_by, v.created_at
    FROM public.campaign_plan_versions v
    JOIN public.campaigns c ON c.id = v.campaign_id
   WHERE c.public_plan_token = p_token
     AND (c.token_revoked_at IS NULL)
   ORDER BY v.version DESC
$$;

GRANT EXECUTE ON FUNCTION public.list_campaign_plan_versions_by_token(text) TO anon, authenticated;

-- Atualiza client_request_adjustment para snapshotar antes de sobrescrever
CREATE OR REPLACE FUNCTION public.client_request_adjustment(p_token text, p_message text, p_requester_name text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_campaign_id uuid;
  v_camp record;
  v_next_version int;
  v_allocs jsonb;
BEGIN
  IF p_message IS NULL OR length(trim(p_message)) < 3 THEN
    RAISE EXCEPTION 'message_required';
  END IF;

  SELECT id, simulation_snapshot, goal_plays, total_allocated, valor_cobrado, engagement_multiplier, eco_max_pct
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

  UPDATE public.campaigns
     SET client_rejected_at = now(),
         client_adjustment_request = trim(p_message),
         client_approved_at = NULL,
         client_approved_by = COALESCE(trim(p_requester_name), client_approved_by)
   WHERE id = v_camp.id
   RETURNING id INTO v_campaign_id;

  RETURN v_campaign_id;
END;
$function$;
