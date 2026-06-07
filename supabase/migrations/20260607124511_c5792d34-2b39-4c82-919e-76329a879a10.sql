
-- 1) Colunas de baseline em campaigns
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS radio_plays_start bigint,
  ADD COLUMN IF NOT EXISTS radio_plays_start_at timestamptz;

-- 2) Função que captura a baseline a partir do snapshot mais recente
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
  -- só age quando a campanha passa pra active OU é inserida já ativa
  IF NEW.spotify_track_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  IF NEW.radio_plays_start IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' AND OLD.radio_plays_start IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT ssp.plays_7d, s.captured_at
    INTO v_plays, v_at
  FROM public.song_snapshots s
  JOIN public.song_snapshot_playlists ssp ON ssp.snapshot_id = s.id
  WHERE ssp.spotify_playlist_id = 'radio'
    AND ssp.plays_7d IS NOT NULL
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

DROP TRIGGER IF EXISTS trg_capture_radio_baseline ON public.campaigns;
CREATE TRIGGER trg_capture_radio_baseline
BEFORE INSERT OR UPDATE OF status ON public.campaigns
FOR EACH ROW
EXECUTE FUNCTION public.capture_campaign_radio_baseline();

-- 3) Backfill: tentar capturar pra campanhas ativas sem baseline
UPDATE public.campaigns c
SET radio_plays_start = sub.plays_7d,
    radio_plays_start_at = sub.captured_at
FROM (
  SELECT DISTINCT ON (s.spotify_song_id)
    s.spotify_song_id,
    ssp.plays_7d,
    s.captured_at
  FROM public.song_snapshots s
  JOIN public.song_snapshot_playlists ssp ON ssp.snapshot_id = s.id
  WHERE ssp.spotify_playlist_id = 'radio'
    AND ssp.plays_7d IS NOT NULL
  ORDER BY s.spotify_song_id, s.captured_at ASC
) sub
WHERE c.spotify_track_id = sub.spotify_song_id
  AND c.status = 'active'
  AND c.radio_plays_start IS NULL;

-- 4) View reescrita: baseline-anchored
DROP VIEW IF EXISTS public.campaign_radio_collected;

CREATE VIEW public.campaign_radio_collected AS
WITH latest AS (
  SELECT DISTINCT ON (s.spotify_song_id)
    s.spotify_song_id,
    s.captured_at,
    ssp.plays_7d
  FROM public.song_snapshots s
  JOIN public.song_snapshot_playlists ssp ON ssp.snapshot_id = s.id
  WHERE ssp.spotify_playlist_id = 'radio'
    AND ssp.plays_7d IS NOT NULL
    AND s.spotify_song_id IS NOT NULL
  ORDER BY s.spotify_song_id, s.captured_at DESC
)
SELECT
  c.id AS campaign_id,
  c.spotify_track_id,
  c.radio_plays_start AS start_plays_7d,
  c.radio_plays_start_at AS start_captured_at,
  l.plays_7d AS current_plays_7d,
  l.captured_at AS last_captured_at,
  GREATEST(
    l.plays_7d - COALESCE(c.radio_plays_start, l.plays_7d),
    0
  )::bigint AS radio_delta
FROM public.campaigns c
JOIN latest l ON l.spotify_song_id = c.spotify_track_id;

GRANT SELECT ON public.campaign_radio_collected TO authenticated, service_role;
