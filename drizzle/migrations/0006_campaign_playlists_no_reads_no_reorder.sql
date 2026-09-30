CREATE OR REPLACE FUNCTION public.block_campaign_auto_ops()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'playlist_operation_queue' THEN
    IF NEW.operation_type IN ('AUTO_SYNC','DIAGNOSE_ENGINE','BRAIN_CALC','MAINTENANCE','BACKFILL')
       AND EXISTS (SELECT 1 FROM managed_playlists WHERE id = NEW.playlist_id AND playlist_type = 'CAMPAIGN') THEN
      RETURN NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'playlist_execution_jobs' THEN
    IF NEW.job_type = 'playlist.track.reorder'
       AND EXISTS (SELECT 1 FROM managed_playlists
                   WHERE playlist_type = 'CAMPAIGN'
                     AND (id = NEW.playlist_id OR spotify_playlist_id = NEW.spotify_playlist_id)) THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_campaign_auto_ops ON public.playlist_operation_queue;
CREATE TRIGGER trg_block_campaign_auto_ops BEFORE INSERT ON public.playlist_operation_queue
FOR EACH ROW EXECUTE FUNCTION public.block_campaign_auto_ops();

DROP TRIGGER IF EXISTS trg_block_campaign_reorder ON public.playlist_execution_jobs;
CREATE TRIGGER trg_block_campaign_reorder BEFORE INSERT ON public.playlist_execution_jobs
FOR EACH ROW EXECUTE FUNCTION public.block_campaign_auto_ops();

UPDATE public.playlist_operation_queue q SET status = 'cancelled'
WHERE q.status = 'pending'
  AND q.operation_type IN ('AUTO_SYNC','DIAGNOSE_ENGINE','BRAIN_CALC','MAINTENANCE','BACKFILL')
  AND EXISTS (SELECT 1 FROM managed_playlists m WHERE m.id = q.playlist_id AND m.playlist_type = 'CAMPAIGN');

UPDATE public.playlist_execution_jobs j SET status = 'cancelled', last_error = 'campaign_reorder_disabled'
WHERE j.job_type = 'playlist.track.reorder' AND j.status IN ('pending','queued','retry')
  AND EXISTS (SELECT 1 FROM managed_playlists m WHERE m.playlist_type='CAMPAIGN'
              AND (m.id = j.playlist_id OR m.spotify_playlist_id = j.spotify_playlist_id));