-- 1) Recria is_observational como coluna real (estava como GENERATED)
DROP INDEX IF EXISTS public.idx_curator_playlists_is_observational;
ALTER TABLE public.curator_playlists DROP COLUMN is_observational CASCADE;
ALTER TABLE public.curator_playlists ADD COLUMN is_observational boolean NOT NULL DEFAULT false;
CREATE INDEX idx_curator_playlists_is_observational
  ON public.curator_playlists (is_observational) WHERE is_observational = false;

-- 2) Recria as 2 views que dependiam da coluna (DROP CASCADE removeu)
CREATE OR REPLACE VIEW public.v_curator_playlists_operational
WITH (security_invoker=on) AS
SELECT
  id, deal_id, spotify_url, playlist_name, followers, is_baseline, added_at,
  song_id, spotify_playlist_id, spotify_owner_id, spotify_owner_name, image_url,
  added_at_spotify, match_status, match_reason, streams_7d, streams_28d, streams_total,
  position_in_paste, last_paste_at, attribution_method, attribution_reason,
  canonical_playlist_id, is_observational
FROM public.curator_playlists
WHERE is_observational = false;

CREATE OR REPLACE VIEW public.v_curator_playlists_observational
WITH (security_invoker=on) AS
SELECT
  id, deal_id, spotify_url, playlist_name, followers, is_baseline, added_at,
  song_id, spotify_playlist_id, spotify_owner_id, spotify_owner_name, image_url,
  added_at_spotify, match_status, match_reason, streams_7d, streams_28d, streams_total,
  position_in_paste, last_paste_at, attribution_method, attribution_reason,
  canonical_playlist_id, is_observational
FROM public.curator_playlists
WHERE is_observational = true;

GRANT SELECT ON public.v_curator_playlists_operational TO authenticated, service_role;
GRANT SELECT ON public.v_curator_playlists_observational TO authenticated, service_role;

-- 3) Trigger: calcula is_observational + bloqueia contaminação cruzada
CREATE OR REPLACE FUNCTION public.compute_curator_playlist_observational()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_internal boolean := false;
BEGIN
  -- Regra original: baseline_observed sem playlist real = observacional
  NEW.is_observational := (NEW.attribution_method = 'baseline_observed' AND NEW.spotify_playlist_id IS NULL);

  -- Nova proteção: owner pertence ao ecossistema interno?
  IF NEW.spotify_owner_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.accounts WHERE spotify_user_id = NEW.spotify_owner_id
    ) INTO is_internal;
  END IF;

  IF NOT is_internal AND NEW.spotify_owner_name IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.accounts WHERE lower(display_name) = lower(NEW.spotify_owner_name)
    ) INTO is_internal;
  END IF;

  IF is_internal THEN
    NEW.is_observational := true;
    -- Zera streams pra não inflar KPIs/CPP do curador externo
    NEW.streams_total := 0;
    NEW.streams_7d := 0;
    NEW.streams_28d := 0;
    IF NEW.attribution_reason IS NULL OR NEW.attribution_reason = '' THEN
      NEW.attribution_reason := 'owner pertence ao ecossistema interno — não conta como entrega';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_observational ON public.curator_playlists;
CREATE TRIGGER trg_compute_observational
BEFORE INSERT OR UPDATE OF attribution_method, spotify_playlist_id, spotify_owner_id, spotify_owner_name, streams_total, streams_7d, streams_28d
ON public.curator_playlists
FOR EACH ROW
EXECUTE FUNCTION public.compute_curator_playlist_observational();

-- 4) BACKFILL: dispara o trigger em todas as linhas (no-op update)
UPDATE public.curator_playlists
SET attribution_method = attribution_method
WHERE attribution_method IS NOT NULL;

COMMENT ON FUNCTION public.compute_curator_playlist_observational() IS
'Calcula is_observational e bloqueia contaminação cruzada: se owner_id/owner_name de uma curator_playlist pertencer a uma conta interna (accounts), força is_observational=true e zera streams. Garante que playlists nossas nunca sejam contabilizadas como entrega de curador externo.';