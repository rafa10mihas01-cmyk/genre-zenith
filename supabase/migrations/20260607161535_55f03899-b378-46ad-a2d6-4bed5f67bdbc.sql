
-- 1) Trigger: ignorar valores placeholder (<= 1) ao âncorar baseline
CREATE OR REPLACE FUNCTION public.capture_campaign_radio_baseline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plays bigint;
  v_at timestamptz;
BEGIN
  IF NEW.spotify_track_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  IF NEW.radio_plays_start IS NOT NULL AND NEW.radio_plays_start > 1 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active'
     AND OLD.radio_plays_start IS NOT NULL AND OLD.radio_plays_start > 1 THEN
    RETURN NEW;
  END IF;

  SELECT ssp.plays_7d, s.captured_at
    INTO v_plays, v_at
  FROM public.song_snapshots s
  JOIN public.song_snapshot_playlists ssp ON ssp.snapshot_id = s.id
  WHERE (ssp.spotify_playlist_id = 'radio'
         OR (ssp.spotify_playlist_id IS NULL AND lower(ssp.name) = 'radio'))
    AND ssp.plays_7d IS NOT NULL
    AND ssp.plays_7d > 1
    AND s.spotify_song_id = NEW.spotify_track_id
  ORDER BY s.captured_at DESC
  LIMIT 1;

  IF v_plays IS NOT NULL THEN
    NEW.radio_plays_start := v_plays;
    NEW.radio_plays_start_at := v_at;
  END IF;
  RETURN NEW;
END;
$$;

-- 2) Backfill: re-âncora campanhas que ficaram presas em baseline <= 1
WITH latest_valid AS (
  SELECT DISTINCT ON (s.spotify_song_id)
    s.spotify_song_id,
    ssp.plays_7d,
    s.captured_at
  FROM public.song_snapshots s
  JOIN public.song_snapshot_playlists ssp ON ssp.snapshot_id = s.id
  WHERE (ssp.spotify_playlist_id = 'radio'
         OR (ssp.spotify_playlist_id IS NULL AND lower(ssp.name) = 'radio'))
    AND ssp.plays_7d IS NOT NULL
    AND ssp.plays_7d > 1
  ORDER BY s.spotify_song_id, s.captured_at DESC
)
UPDATE public.campaigns c
SET radio_plays_start = lv.plays_7d,
    radio_plays_start_at = lv.captured_at
FROM latest_valid lv
WHERE c.spotify_track_id = lv.spotify_song_id
  AND c.radio_plays_start IS NOT NULL
  AND c.radio_plays_start <= 1;
