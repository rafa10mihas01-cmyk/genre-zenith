
-- 1) Trigger: ao inserir snapshot não-baseline, propaga plays pra curator_playlists
CREATE OR REPLACE FUNCTION public.sync_curator_playlist_streams_from_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_baseline = true THEN
    RETURN NEW;
  END IF;
  UPDATE public.curator_playlists
     SET streams_7d    = COALESCE(NEW.plays_7d,  streams_7d),
         streams_28d   = COALESCE(NEW.plays_28d, streams_28d),
         streams_total = GREATEST(COALESCE(streams_total, 0), COALESCE(NEW.plays, 0))
   WHERE id = NEW.playlist_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_curator_playlist_streams ON public.curator_deal_snapshots;
CREATE TRIGGER trg_sync_curator_playlist_streams
AFTER INSERT ON public.curator_deal_snapshots
FOR EACH ROW EXECUTE FUNCTION public.sync_curator_playlist_streams_from_snapshot();

-- 2) Backfill: pega o snapshot mais recente (não-baseline) de cada playlist
--    e propaga pros campos da curator_playlists.
WITH latest AS (
  SELECT DISTINCT ON (playlist_id)
    playlist_id, plays, plays_7d, plays_28d, captured_at
  FROM public.curator_deal_snapshots
  WHERE is_baseline = false
  ORDER BY playlist_id, captured_at DESC
)
UPDATE public.curator_playlists cp
   SET streams_7d    = COALESCE(l.plays_7d,  cp.streams_7d),
       streams_28d   = COALESCE(l.plays_28d, cp.streams_28d),
       streams_total = GREATEST(COALESCE(cp.streams_total, 0), COALESCE(l.plays, 0))
  FROM latest l
 WHERE cp.id = l.playlist_id;
