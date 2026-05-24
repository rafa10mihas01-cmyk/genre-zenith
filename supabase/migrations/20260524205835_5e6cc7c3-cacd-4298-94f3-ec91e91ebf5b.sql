
-- ============================================================
-- PARTE 1: Adicionar guard has_team_access em 2 funções
-- ============================================================

-- approve_campaign: adiciona guard no topo
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
           started_at = COALESCE(started_at, now())
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
         started_at = COALESCE(started_at, now())
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object('campaign_id', p_campaign_id, 'deal_id', v_deal_id, 'reused', false);
END; $function$;

-- apply_playlist_cooldown: adiciona guard no topo
CREATE OR REPLACE FUNCTION public.apply_playlist_cooldown(
  _playlist_id uuid,
  _action curatorial_action_type,
  _reason text DEFAULT NULL::text,
  _days integer DEFAULT NULL::integer,
  _triggered_by uuid DEFAULT NULL::uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_days integer; v_id uuid;
BEGIN
  IF NOT public.has_team_access() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_days := COALESCE(_days, public.default_cooldown_days(_action));
  INSERT INTO public.playlist_cooldowns (playlist_id, action_type, started_at, cooldown_until, reason, triggered_by)
  VALUES (_playlist_id, _action, now(), now() + (v_days || ' days')::interval, _reason, _triggered_by)
  RETURNING id INTO v_id;

  UPDATE public.managed_playlists
    SET last_maintenance_at = now(),
        last_maintenance_intensity = _action,
        updated_at = now()
    WHERE id = _playlist_id;
  RETURN v_id;
END; $function$;

-- ============================================================
-- PARTE 2: Revogar EXECUTE de PUBLIC + authenticated em 5 funções
-- (mantendo apenas service role)
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.pick_next_account(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_account_playlists(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_notification(notification_type, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_notification(text, text, text, text, jsonb, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_followers_revalidation_candidates(integer, integer, interval) FROM PUBLIC, anon, authenticated;
