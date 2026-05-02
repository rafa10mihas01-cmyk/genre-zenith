-- Fase 1: Schema para importação de paste Spotify for Artists e classificação anti-fraude

-- 1) curator_deals: identidade Spotify do curador
ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS spotify_owner_id text,
  ADD COLUMN IF NOT EXISTS spotify_owner_url text;

-- 2) curator_playlists: enriquecimento + classificação
ALTER TABLE public.curator_playlists
  ADD COLUMN IF NOT EXISTS spotify_playlist_id text,
  ADD COLUMN IF NOT EXISTS spotify_owner_id text,
  ADD COLUMN IF NOT EXISTS spotify_owner_name text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS added_at_spotify date,
  ADD COLUMN IF NOT EXISTS match_status text NOT NULL DEFAULT 'organic',
  ADD COLUMN IF NOT EXISTS match_reason text,
  ADD COLUMN IF NOT EXISTS streams_7d bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streams_28d bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streams_total bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS position_in_paste integer,
  ADD COLUMN IF NOT EXISTS last_paste_at timestamptz;

-- Validação dos status permitidos via trigger (CHECK constraints rígidos podem dar dor depois)
CREATE OR REPLACE FUNCTION public.validate_curator_playlist_match_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.match_status NOT IN ('curator','baseline','editorial','suspicious','organic') THEN
    RAISE EXCEPTION 'match_status inválido: %. Use curator, baseline, editorial, suspicious ou organic.', NEW.match_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_curator_playlist_match_status ON public.curator_playlists;
CREATE TRIGGER trg_validate_curator_playlist_match_status
  BEFORE INSERT OR UPDATE ON public.curator_playlists
  FOR EACH ROW EXECUTE FUNCTION public.validate_curator_playlist_match_status();

-- Unicidade: uma playlist por deal (upsert seguro)
CREATE UNIQUE INDEX IF NOT EXISTS idx_curator_playlists_deal_playlist
  ON public.curator_playlists (deal_id, spotify_playlist_id)
  WHERE spotify_playlist_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_curator_playlists_match_status
  ON public.curator_playlists (deal_id, match_status);

CREATE INDEX IF NOT EXISTS idx_curator_playlists_owner
  ON public.curator_playlists (spotify_owner_id);

-- 3) Histórico de imports
CREATE TABLE IF NOT EXISTS public.curator_paste_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  song_id uuid,
  raw_text text NOT NULL,
  parsed_count integer NOT NULL DEFAULT 0,
  new_count integer NOT NULL DEFAULT 0,
  baseline_count integer NOT NULL DEFAULT 0,
  editorial_count integer NOT NULL DEFAULT 0,
  curator_count integer NOT NULL DEFAULT 0,
  suspicious_count integer NOT NULL DEFAULT 0,
  organic_count integer NOT NULL DEFAULT 0,
  total_streams_7d bigint NOT NULL DEFAULT 0,
  imported_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_curator_paste_imports_deal
  ON public.curator_paste_imports (deal_id, created_at DESC);

ALTER TABLE public.curator_paste_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own paste_imports" ON public.curator_paste_imports;
CREATE POLICY "Users select own paste_imports"
  ON public.curator_paste_imports FOR SELECT
  TO authenticated
  USING (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users insert own paste_imports" ON public.curator_paste_imports;
CREATE POLICY "Users insert own paste_imports"
  ON public.curator_paste_imports FOR INSERT
  TO authenticated
  WITH CHECK (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users delete own paste_imports" ON public.curator_paste_imports;
CREATE POLICY "Users delete own paste_imports"
  ON public.curator_paste_imports FOR DELETE
  TO authenticated
  USING (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));