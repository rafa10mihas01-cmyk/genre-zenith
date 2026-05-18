
CREATE OR REPLACE FUNCTION public.tg_campaign_shadow_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id uuid;
  v_existing uuid;
  v_user uuid;
BEGIN
  IF NEW.status NOT IN ('active', 'dispatched') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.spotify_track_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_existing FROM public.curator_deals WHERE campaign_id = NEW.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_user := NEW.created_by;
  IF v_user IS NULL THEN
    SELECT user_id INTO v_user FROM public.curator_deals
      WHERE user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.curator_deals (
    user_id, curator_name, song_spotify_url, song_name, song_artist,
    target_plays, baseline_plays, cost, started_at, state, source, campaign_id
  ) VALUES (
    v_user, 'Eco Interno (campanha)',
    COALESCE(NEW.spotify_track_url, 'spotify:track:' || NEW.spotify_track_id),
    NEW.track_name, NEW.artist, COALESCE(NEW.goal_plays, 0), 0, 0, now(),
    'active', 'campaign_internal', NEW.id
  ) RETURNING id INTO v_deal_id;

  INSERT INTO public.curator_deal_songs (
    deal_id, spotify_track_id, song_spotify_url, song_name, song_artist,
    auto_collect, auto_collect_interval_minutes, auto_collect_status, position, started_at
  ) VALUES (
    v_deal_id, NEW.spotify_track_id,
    COALESCE(NEW.spotify_track_url, 'spotify:track:' || NEW.spotify_track_id),
    NEW.track_name, NEW.artist, true, 1440, 'idle', 1, now()
  );

  RETURN NEW;
END;
$$;

-- Re-backfill ativas
DO $$
DECLARE r record; v_deal_id uuid; v_user uuid;
BEGIN
  FOR r IN
    SELECT c.* FROM public.campaigns c
    LEFT JOIN public.curator_deals d ON d.campaign_id = c.id
    WHERE c.status IN ('active', 'dispatched')
      AND c.spotify_track_id IS NOT NULL
      AND d.id IS NULL
  LOOP
    v_user := r.created_by;
    IF v_user IS NULL THEN
      SELECT user_id INTO v_user FROM public.curator_deals
        WHERE user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;
    END IF;
    IF v_user IS NULL THEN CONTINUE; END IF;

    INSERT INTO public.curator_deals (
      user_id, curator_name, song_spotify_url, song_name, song_artist,
      target_plays, baseline_plays, cost, started_at, state, source, campaign_id
    ) VALUES (
      v_user, 'Eco Interno (campanha)',
      COALESCE(r.spotify_track_url, 'spotify:track:' || r.spotify_track_id),
      r.track_name, r.artist, COALESCE(r.goal_plays, 0), 0, 0, now(),
      'active', 'campaign_internal', r.id
    ) RETURNING id INTO v_deal_id;

    INSERT INTO public.curator_deal_songs (
      deal_id, spotify_track_id, song_spotify_url, song_name, song_artist,
      auto_collect, auto_collect_interval_minutes, auto_collect_status, position, started_at
    ) VALUES (
      v_deal_id, r.spotify_track_id,
      COALESCE(r.spotify_track_url, 'spotify:track:' || r.spotify_track_id),
      r.track_name, r.artist, true, 1440, 'idle', 1, now()
    );
  END LOOP;
END $$;
