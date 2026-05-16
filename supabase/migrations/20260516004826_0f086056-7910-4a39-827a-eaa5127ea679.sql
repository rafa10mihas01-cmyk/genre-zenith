ALTER TABLE public.curator_deal_baseline_playlists
ADD COLUMN IF NOT EXISTS song_id uuid;

UPDATE public.curator_deal_baseline_playlists b
SET song_id = s.song_id
FROM public.curator_deal_snapshots s
WHERE b.snapshot_id = s.id
  AND b.song_id IS NULL
  AND s.song_id IS NOT NULL;

UPDATE public.curator_deal_baseline_playlists b
SET song_id = cp.song_id
FROM public.curator_playlists cp
WHERE b.deal_id = cp.deal_id
  AND b.spotify_playlist_id = cp.spotify_playlist_id
  AND b.song_id IS NULL
  AND cp.is_baseline = true
  AND cp.song_id IS NOT NULL;

DROP INDEX IF EXISTS public.curator_deal_baseline_playlists_unique;

CREATE UNIQUE INDEX IF NOT EXISTS curator_deal_baseline_playlists_song_unique
  ON public.curator_deal_baseline_playlists (deal_id, song_id, spotify_playlist_id)
  WHERE song_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS curator_deal_baseline_playlists_legacy_unique
  ON public.curator_deal_baseline_playlists (deal_id, spotify_playlist_id)
  WHERE song_id IS NULL;

CREATE OR REPLACE FUNCTION public.is_playlist_in_deal_baseline(
  p_deal_id uuid,
  p_spotify_playlist_id text,
  p_song_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.curator_deal_baseline_playlists
    WHERE deal_id = p_deal_id
      AND spotify_playlist_id = p_spotify_playlist_id
      AND (
        (p_song_id IS NOT NULL AND song_id = p_song_id)
        OR (p_song_id IS NULL AND song_id IS NULL)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.enforce_curator_playlist_baseline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in_baseline boolean;
  v_has_any_baseline boolean;
BEGIN
  IF NEW.is_baseline = true OR NEW.spotify_playlist_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.curator_deal_baseline_playlists
    WHERE deal_id = NEW.deal_id
      AND (
        (NEW.song_id IS NOT NULL AND song_id = NEW.song_id)
        OR (NEW.song_id IS NULL AND song_id IS NULL)
      )
  ) INTO v_has_any_baseline;

  IF NOT v_has_any_baseline THEN
    RETURN NEW;
  END IF;

  SELECT public.is_playlist_in_deal_baseline(NEW.deal_id, NEW.spotify_playlist_id, NEW.song_id)
    INTO v_in_baseline;

  IF v_in_baseline THEN
    RAISE EXCEPTION 'Essa playlist já existia no baseline desta música e não pode ser atribuída ao curador.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.attribution_method IS NULL OR NEW.attribution_method = 'baseline_observed' THEN
    NEW.attribution_method := 'baseline_zero';
    NEW.attribution_reason := COALESCE(NEW.attribution_reason, 'not_in_song_baseline');
  END IF;

  RETURN NEW;
END;
$$;