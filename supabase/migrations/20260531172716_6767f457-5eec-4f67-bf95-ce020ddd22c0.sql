
CREATE OR REPLACE FUNCTION public.tg_ccp_match_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
  v_captured_at TIMESTAMPTZ;
BEGIN
  IF NEW.status <> 'pending_match' THEN
    RETURN NEW;
  END IF;

  SELECT collection_run_id, captured_at
    INTO v_run_id, v_captured_at
    FROM public.campaign_playlist_collections
   WHERE campaign_id = NEW.campaign_id
     AND playlist_id = NEW.playlist_id
   ORDER BY captured_at ASC
   LIMIT 1;

  IF v_run_id IS NOT NULL THEN
    NEW.status := 'matched';
    NEW.matched_at := v_captured_at;
    NEW.first_seen_collection_run_id := v_run_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ccp_match_on_insert ON public.curator_campaign_playlists;
CREATE TRIGGER trg_ccp_match_on_insert
  BEFORE INSERT ON public.curator_campaign_playlists
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_ccp_match_on_insert();
