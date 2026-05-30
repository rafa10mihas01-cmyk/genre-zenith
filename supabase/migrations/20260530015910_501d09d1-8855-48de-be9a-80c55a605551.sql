
-- approve_campaign: torna idempotente quando campanha já está ativa
CREATE OR REPLACE FUNCTION public.approve_campaign(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign public.campaigns%ROWTYPE;
  v_curator_name text;
  v_deal_id uuid;
BEGIN
  IF NOT public.has_team_access() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;
  IF v_campaign.client_approved_at IS NULL THEN
    RAISE EXCEPTION 'client_approval_required'
      USING HINT = 'Compartilhe o link público com o cliente e aguarde a aprovação antes de aprovar internamente.';
  END IF;

  -- Idempotência: se já está ativa com deal, apenas garante eco_dispatched_at e retorna sucesso
  IF v_campaign.status = 'active' AND v_campaign.deal_id IS NOT NULL THEN
    UPDATE public.campaigns
       SET eco_dispatched_at = COALESCE(eco_dispatched_at, now()),
           started_at = COALESCE(started_at, now()),
           snapshot_locked_at = COALESCE(snapshot_locked_at, now())
     WHERE id = p_campaign_id;
    RETURN jsonb_build_object('campaign_id', p_campaign_id, 'deal_id', v_campaign.deal_id, 'reused', true, 'already_active', true);
  END IF;

  IF v_campaign.status NOT IN ('draft','paused') THEN
    RAISE EXCEPTION 'campaign_not_in_approvable_state' USING DETAIL = v_campaign.status;
  END IF;
  IF v_campaign.curator_id IS NULL THEN
    RAISE EXCEPTION 'curator_required';
  END IF;

  IF v_campaign.deal_id IS NOT NULL THEN
    UPDATE public.campaigns
       SET status = 'active',
           snapshot_locked_at = COALESCE(snapshot_locked_at, now()),
           started_at = COALESCE(started_at, now()),
           eco_dispatched_at = COALESCE(eco_dispatched_at, now())
     WHERE id = p_campaign_id;
    RETURN jsonb_build_object('campaign_id', p_campaign_id, 'deal_id', v_campaign.deal_id, 'reused', true);
  END IF;

  SELECT name INTO v_curator_name FROM public.curators WHERE id = v_campaign.curator_id;

  INSERT INTO public.curator_deals (
    user_id, curator_id, curator_name,
    song_spotify_url, song_name, song_artist, song_cover_url,
    target_plays, campaign_id, state, source, origin
  ) VALUES (
    v_campaign.created_by,
    v_campaign.curator_id,
    COALESCE(v_curator_name, 'Curador'),
    COALESCE(v_campaign.spotify_track_url, ''),
    COALESCE(v_campaign.track_name, 'Faixa'),
    v_campaign.artist,
    v_campaign.cover_url,
    COALESCE(v_campaign.goal_plays, 0),
    p_campaign_id,
    'awaiting_playlists',
    'campaign',
    'campaign_approval'
  ) RETURNING id INTO v_deal_id;

  UPDATE public.campaigns
     SET status = 'active',
         deal_id = v_deal_id,
         snapshot_locked_at = COALESCE(snapshot_locked_at, now()),
         started_at = COALESCE(started_at, now()),
         eco_dispatched_at = COALESCE(eco_dispatched_at, now())
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object('campaign_id', p_campaign_id, 'deal_id', v_deal_id, 'reused', false);
END; $function$;

-- Backfill: campanhas ativas com deal mas sem eco_dispatched_at
UPDATE public.campaigns
   SET eco_dispatched_at = COALESCE(started_at, snapshot_locked_at, now())
 WHERE status = 'active' AND deal_id IS NOT NULL AND eco_dispatched_at IS NULL;
