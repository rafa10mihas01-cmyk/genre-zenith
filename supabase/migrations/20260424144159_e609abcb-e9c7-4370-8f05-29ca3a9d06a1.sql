-- =========================================================
-- AUDITORIA #8 — FASE A + B + C
-- =========================================================

-- ----- B.3) UNIQUE em spotify_oauth_states.state -----
-- Limpeza preventiva (caso haja duplicado):
DELETE FROM public.spotify_oauth_states a
 USING public.spotify_oauth_states b
 WHERE a.ctid < b.ctid
   AND a.state = b.state;

ALTER TABLE public.spotify_oauth_states
  ADD CONSTRAINT spotify_oauth_states_state_unique UNIQUE (state);

-- ----- C.3) Índice em genre_models(genre_id) -----
CREATE INDEX IF NOT EXISTS idx_genre_models_genre_id
  ON public.genre_models (genre_id);

-- ----- A.4) Trigger para garantir scored_at em templates approved -----
CREATE OR REPLACE FUNCTION public.ensure_scored_at_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Quando template vira approved sem scored_at, preenche com now()
  IF NEW.status = 'approved' AND NEW.scored_at IS NULL THEN
    NEW.scored_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_scored_at_on_approval ON public.playlist_templates;
CREATE TRIGGER trg_ensure_scored_at_on_approval
  BEFORE INSERT OR UPDATE OF status ON public.playlist_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_scored_at_on_approval();

-- Backfill imediato dos approved sem scored_at
UPDATE public.playlist_templates
   SET scored_at = COALESCE(approved_at, updated_at, created_at)
 WHERE status = 'approved'
   AND scored_at IS NULL;

-- ----- A.3) Backfill followers_at_creation = 0 nos templates created sem valor -----
-- (apenas marca como 0 — Spotify API pode preencher de verdade depois via track-playlist-metrics)
UPDATE public.playlist_templates
   SET followers_at_creation = 0
 WHERE status = 'created'
   AND spotify_playlist_id IS NOT NULL
   AND followers_at_creation IS NULL;

-- ----- C.5) Limpeza imediata dos brain-job-legacy -----
DELETE FROM public.collection_logs
 WHERE acao = 'brain-job-legacy';