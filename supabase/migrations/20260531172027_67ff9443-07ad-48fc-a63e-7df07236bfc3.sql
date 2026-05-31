
ALTER TABLE public.curator_campaign_playlists
  ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_seen_collection_run_id UUID;

CREATE OR REPLACE FUNCTION public.tg_ccp_auto_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.curator_campaign_playlists
     SET status = 'matched',
         matched_at = COALESCE(matched_at, now()),
         first_seen_collection_run_id = COALESCE(first_seen_collection_run_id, NEW.collection_run_id)
   WHERE campaign_id = NEW.campaign_id
     AND playlist_id = NEW.playlist_id
     AND status = 'pending_match';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ccp_auto_match ON public.campaign_playlist_collections;
CREATE TRIGGER trg_ccp_auto_match
  AFTER INSERT ON public.campaign_playlist_collections
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_ccp_auto_match();
