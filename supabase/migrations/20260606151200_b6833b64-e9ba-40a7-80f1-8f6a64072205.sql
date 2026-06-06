CREATE OR REPLACE FUNCTION public.approve_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign public.campaigns%ROWTYPE;
  v_deal_id uuid;
  v_baseline_count int;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
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

  IF v_campaign.collection_mode = 'spreadsheet' AND v_campaign.deal_id IS NOT NULL THEN
    SELECT count(*) INTO v_baseline_count
      FROM public.label_spreadsheet_uploads
     WHERE deal_id = v_campaign.deal_id
       AND is_baseline = true
       AND status = 'done';
    IF v_baseline_count = 0 THEN
      RAISE EXCEPTION 'baseline_required'
        USING HINT = 'Peça ao cliente para enviar a primeira planilha (baseline) no portal antes de distribuir a campanha.';
    END IF;
  END IF;

  v_deal_id := v_campaign.deal_id;
  IF v_deal_id IS NULL THEN
    INSERT INTO public.curator_deals (
      user_id, curator_id, curator_name,
      song_spotify_url, song_name, song_artist, song_cover_url,
      target_plays, started_at, campaign_id,
      state, collection_mode, origin
    )
    SELECT
      COALESCE(v_campaign.created_by, auth.uid()),
      v_campaign.curator_id,
      COALESCE(cu.name, 'Curador'),
      COALESCE(v_campaign.spotify_track_url, ''),
      v_campaign.track_name,
      v_campaign.artist,
      v_campaign.cover_url,
      v_campaign.goal_plays,
      now(),
      v_campaign.id,
      'active',
      COALESCE(v_campaign.collection_mode, 'bot'),
      'campaign_internal'
    FROM public.curators cu
    WHERE cu.id = v_campaign.curator_id
    RETURNING id INTO v_deal_id;
  END IF;

  UPDATE public.campaigns
     SET status = 'active',
         deal_id = COALESCE(deal_id, v_deal_id),
         snapshot_locked_at = COALESCE(snapshot_locked_at, now()),
         eco_dispatched_at = COALESCE(eco_dispatched_at, now())
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'campaign_id', p_campaign_id,
    'deal_id', v_deal_id,
    'reused_existing_deal', (v_campaign.deal_id IS NOT NULL)
  );
END;
$$;