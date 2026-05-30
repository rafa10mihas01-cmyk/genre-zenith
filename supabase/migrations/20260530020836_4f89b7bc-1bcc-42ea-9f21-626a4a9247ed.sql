CREATE OR REPLACE FUNCTION public.approve_campaign(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign public.campaigns%ROWTYPE;
  v_required_count integer := 0;
  v_collected_count integer := 0;
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
  IF v_campaign.curator_id IS NULL THEN
    RAISE EXCEPTION 'curator_required';
  END IF;
  IF v_campaign.deal_id IS NULL THEN
    RAISE EXCEPTION 'baseline_required'
      USING HINT = 'Aprove o plano interno e aguarde a coleta da baseline antes de distribuir.';
  END IF;

  SELECT
    COUNT(DISTINCT a.managed_playlist_id),
    COUNT(DISTINCT a.managed_playlist_id) FILTER (
      WHERE EXISTS (
        SELECT 1
        FROM public.curator_deal_snapshots cds
        JOIN public.curator_playlists cp ON cp.id = cds.playlist_id
        WHERE cds.deal_id = v_campaign.deal_id
          AND cds.is_baseline = true
          AND cp.spotify_playlist_id = mp.spotify_playlist_id
      )
    )
  INTO v_required_count, v_collected_count
  FROM public.campaign_eco_allocations a
  JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
  WHERE a.campaign_id = p_campaign_id;

  IF COALESCE(v_required_count, 0) = 0 THEN
    RAISE EXCEPTION 'baseline_required'
      USING HINT = 'A campanha precisa ter playlists internas planejadas antes de distribuir.';
  END IF;

  IF COALESCE(v_collected_count, 0) < COALESCE(v_required_count, 0) THEN
    RAISE EXCEPTION 'baseline_required'
      USING DETAIL = COALESCE(v_collected_count, 0)::text || '/' || COALESCE(v_required_count, 0)::text,
            HINT = 'Aguarde a coleta da baseline em todas as playlists antes de iniciar a distribuição.';
  END IF;

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

  UPDATE public.campaigns
     SET status = 'active',
         snapshot_locked_at = COALESCE(snapshot_locked_at, now()),
         started_at = COALESCE(started_at, now()),
         eco_dispatched_at = COALESCE(eco_dispatched_at, now())
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object('campaign_id', p_campaign_id, 'deal_id', v_campaign.deal_id, 'reused', true);
END; $function$;

GRANT EXECUTE ON FUNCTION public.approve_campaign(uuid) TO authenticated;