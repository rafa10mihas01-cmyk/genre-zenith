CREATE OR REPLACE FUNCTION public.tg_campaign_shadow_deal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deal_id uuid;
  v_existing uuid;
  v_mode text;
  v_auto_collect boolean;
BEGIN
  IF NEW.status NOT IN ('active', 'dispatched') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.spotify_track_id IS NULL OR NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.curator_id IS NOT NULL OR NEW.deal_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_existing FROM public.curator_deals WHERE campaign_id = NEW.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_mode := COALESCE(NEW.collection_mode, 'bot');
  -- Se é planilha, não faz sentido auto_collect=true (bot nunca vai rodar)
  v_auto_collect := (v_mode <> 'spreadsheet');

  INSERT INTO public.curator_deals (
    user_id, curator_name, song_spotify_url, song_name, song_artist,
    target_plays, baseline_plays, cost, started_at, state, source, campaign_id,
    collection_mode
  ) VALUES (
    NEW.created_by, 'Eco Interno (campanha)',
    COALESCE(NEW.spotify_track_url, 'spotify:track:' || NEW.spotify_track_id),
    NEW.track_name, NEW.artist,
    COALESCE(NEW.goal_plays, 0), 0, 0, now(),
    'active', 'campaign_internal', NEW.id,
    v_mode
  )
  RETURNING id INTO v_deal_id;

  INSERT INTO public.curator_deal_songs (
    deal_id, spotify_track_id, song_spotify_url, song_name, song_artist,
    auto_collect, auto_collect_interval_minutes, auto_collect_status, position, started_at
  ) VALUES (
    v_deal_id, NEW.spotify_track_id,
    COALESCE(NEW.spotify_track_url, 'spotify:track:' || NEW.spotify_track_id),
    NEW.track_name, NEW.artist, v_auto_collect, 1440, 'idle', 1, now()
  );

  RETURN NEW;
END;
$function$;