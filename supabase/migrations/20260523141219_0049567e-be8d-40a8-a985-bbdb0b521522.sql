
-- STEP 1: managed_playlists + spotify_accounts + herança
ALTER TABLE public.managed_playlists
  ADD COLUMN IF NOT EXISTS curator_id uuid REFERENCES public.curators(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_managed_playlists_curator_id ON public.managed_playlists(curator_id);

ALTER TABLE public.spotify_accounts
  ADD COLUMN IF NOT EXISTS default_curator_id uuid REFERENCES public.curators(id) ON DELETE SET NULL;

UPDATE public.spotify_accounts
   SET default_curator_id = 'f37de5a5-c2e6-44bd-a14e-2718c83b1bd8'::uuid
 WHERE default_curator_id IS NULL;

UPDATE public.managed_playlists mp
   SET curator_id = COALESCE(
         (SELECT sa.default_curator_id FROM public.spotify_accounts sa WHERE sa.id = mp.account_id),
         'f37de5a5-c2e6-44bd-a14e-2718c83b1bd8'::uuid
       )
 WHERE curator_id IS NULL;

CREATE OR REPLACE FUNCTION public.managed_playlists_inherit_curator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.curator_id IS NULL AND NEW.account_id IS NOT NULL THEN
    SELECT sa.default_curator_id INTO NEW.curator_id
      FROM public.spotify_accounts sa WHERE sa.id = NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_managed_playlists_inherit_curator ON public.managed_playlists;
CREATE TRIGGER trg_managed_playlists_inherit_curator
  BEFORE INSERT OR UPDATE OF account_id ON public.managed_playlists
  FOR EACH ROW EXECUTE FUNCTION public.managed_playlists_inherit_curator();

-- STEP 2: pricing — operacional vs mercado + snapshot
ALTER TABLE public.pricing_settings
  ADD COLUMN IF NOT EXISTS market_per_stream_eco numeric NOT NULL DEFAULT 0.028,
  ADD COLUMN IF NOT EXISTS market_per_stream_ext numeric NOT NULL DEFAULT 0.035;

ALTER TABLE public.campaign_eco_allocations
  ADD COLUMN IF NOT EXISTS cost_per_stream_op numeric,
  ADD COLUMN IF NOT EXISTS market_per_stream numeric,
  ADD COLUMN IF NOT EXISTS price_per_stream_sell numeric;

-- STEP 3: aprovação do cliente
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS client_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_approved_by text,
  ADD COLUMN IF NOT EXISTS client_approved_ip text,
  ADD COLUMN IF NOT EXISTS client_rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_adjustment_request text;

CREATE OR REPLACE FUNCTION public.client_approve_campaign(
  p_token text, p_approver_name text, p_approver_ip text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_campaign_id uuid;
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
  RETURNING id INTO v_campaign_id;
  IF v_campaign_id IS NULL THEN
    RAISE EXCEPTION 'invalid_token_or_already_approved';
  END IF;
  RETURN v_campaign_id;
END; $$;

CREATE OR REPLACE FUNCTION public.client_request_adjustment(
  p_token text, p_message text, p_requester_name text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_campaign_id uuid;
BEGIN
  IF p_message IS NULL OR length(trim(p_message)) < 3 THEN
    RAISE EXCEPTION 'message_required';
  END IF;
  UPDATE public.campaigns
     SET client_rejected_at = now(),
         client_adjustment_request = trim(p_message),
         client_approved_at = NULL,
         client_approved_by = COALESCE(trim(p_requester_name), client_approved_by)
   WHERE public_plan_token = p_token
  RETURNING id INTO v_campaign_id;
  IF v_campaign_id IS NULL THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;
  RETURN v_campaign_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.client_approve_campaign(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_request_adjustment(text, text, text) TO anon, authenticated;

-- STEP 4: bloquear approve_campaign até cliente aprovar (DROP + recreate)
DROP FUNCTION IF EXISTS public.approve_campaign(uuid);

CREATE OR REPLACE FUNCTION public.approve_campaign(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_campaign public.campaigns%ROWTYPE;
  v_deal_id uuid;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;
  IF v_campaign.client_approved_at IS NULL THEN
    RAISE EXCEPTION 'client_approval_required'
      USING HINT = 'Compartilhe o link público com o cliente e aguarde a aprovação antes de aprovar internamente.';
  END IF;
  IF v_campaign.status NOT IN ('draft','paused') THEN
    RAISE EXCEPTION 'campaign_not_in_approvable_state' USING DETAIL = v_campaign.status;
  END IF;
  IF v_campaign.curator_id IS NULL THEN
    RAISE EXCEPTION 'curator_required';
  END IF;
  INSERT INTO public.curator_deals (curator_id, contracted_plays, status, notes)
  VALUES (v_campaign.curator_id, v_campaign.goal_plays, 'active',
          'Auto-criado pela aprovação da campanha ' || v_campaign.track_name)
  RETURNING id INTO v_deal_id;
  UPDATE public.campaigns
     SET status = 'active',
         deal_id = v_deal_id,
         snapshot_locked_at = COALESCE(snapshot_locked_at, now())
   WHERE id = p_campaign_id;
  RETURN jsonb_build_object('campaign_id', p_campaign_id, 'deal_id', v_deal_id);
END; $$;
