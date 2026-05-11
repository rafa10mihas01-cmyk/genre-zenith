-- 1. Tabela de lista negra de baseline por deal
CREATE TABLE IF NOT EXISTS public.curator_deal_baseline_playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  spotify_playlist_id text NOT NULL,
  playlist_name text,
  snapshot_id uuid,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS curator_deal_baseline_playlists_unique
  ON public.curator_deal_baseline_playlists (deal_id, spotify_playlist_id);

CREATE INDEX IF NOT EXISTS curator_deal_baseline_playlists_deal_idx
  ON public.curator_deal_baseline_playlists (deal_id);

ALTER TABLE public.curator_deal_baseline_playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_cdbp"
  ON public.curator_deal_baseline_playlists FOR SELECT
  TO authenticated USING (has_team_access());

CREATE POLICY "team_insert_cdbp"
  ON public.curator_deal_baseline_playlists FOR INSERT
  TO authenticated WITH CHECK (has_team_access());

CREATE POLICY "team_update_cdbp"
  ON public.curator_deal_baseline_playlists FOR UPDATE
  TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());

CREATE POLICY "team_delete_cdbp"
  ON public.curator_deal_baseline_playlists FOR DELETE
  TO authenticated USING (has_team_access());

-- 2. Função de checagem
CREATE OR REPLACE FUNCTION public.is_playlist_in_deal_baseline(
  p_deal_id uuid,
  p_spotify_playlist_id text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.curator_deal_baseline_playlists
    WHERE deal_id = p_deal_id
      AND spotify_playlist_id = p_spotify_playlist_id
  );
$$;

-- 3. Trigger: bloqueia cadastro de playlist que está na lista negra
--    + marca attribution_method automaticamente quando não está
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
  -- só aplica quando playlist NÃO é a do próprio baseline e tem spotify_playlist_id
  IF NEW.is_baseline = true OR NEW.spotify_playlist_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- se o deal não tem lista negra registrada (deals antigos), não interfere
  SELECT EXISTS(
    SELECT 1 FROM public.curator_deal_baseline_playlists WHERE deal_id = NEW.deal_id
  ) INTO v_has_any_baseline;

  IF NOT v_has_any_baseline THEN
    RETURN NEW;
  END IF;

  SELECT public.is_playlist_in_deal_baseline(NEW.deal_id, NEW.spotify_playlist_id)
    INTO v_in_baseline;

  IF v_in_baseline THEN
    RAISE EXCEPTION 'Essa playlist já existia no baseline da campanha e não pode ser atribuída ao curador.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- não está na lista negra → baseline zero automático
  IF NEW.attribution_method IS NULL OR NEW.attribution_method = 'baseline_observed' THEN
    NEW.attribution_method := 'baseline_zero';
    NEW.attribution_reason := COALESCE(NEW.attribution_reason, 'not_in_deal_baseline');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_curator_playlist_baseline ON public.curator_playlists;
CREATE TRIGGER trg_enforce_curator_playlist_baseline
  BEFORE INSERT ON public.curator_playlists
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_curator_playlist_baseline();