-- ============================================================
-- FASE 5B — Governança de token + FKs nas satélites
-- ============================================================

-- 1) Colunas de governança em curator_deals
ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS token_revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_curator_deals_public_token
  ON public.curator_deals (public_token);

CREATE INDEX IF NOT EXISTS idx_curator_deals_state
  ON public.curator_deals (state);

-- 2) Trigger de coerência: fechar/completar revoga; reabrir limpa
CREATE OR REPLACE FUNCTION public.curator_deals_token_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fechado/completed → revoga automaticamente
  IF NEW.state IN ('closed', 'completed') THEN
    IF NEW.token_revoked_at IS NULL THEN
      NEW.token_revoked_at := now();
    END IF;
  END IF;

  -- Voltando para active/awaiting/collecting → limpa revogação
  IF (TG_OP = 'UPDATE')
     AND NEW.state IN ('active', 'awaiting_playlists', 'collecting', 'paused')
     AND OLD.state IN ('closed', 'completed')
  THEN
    NEW.token_revoked_at := NULL;
    NEW.closed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_curator_deals_token_coherence ON public.curator_deals;
CREATE TRIGGER trg_curator_deals_token_coherence
BEFORE INSERT OR UPDATE ON public.curator_deals
FOR EACH ROW EXECUTE FUNCTION public.curator_deals_token_coherence();

-- 3) Limpeza de órfãos ANTES de adicionar FKs
DELETE FROM public.bot_print_batches
  WHERE deal_id IS NOT NULL
    AND deal_id NOT IN (SELECT id FROM public.curator_deals);

UPDATE public.bot_print_batches
   SET song_id = NULL
 WHERE song_id IS NOT NULL
   AND song_id NOT IN (SELECT id FROM public.curator_deal_songs);

UPDATE public.bot_events
   SET deal_id = NULL
 WHERE deal_id IS NOT NULL
   AND deal_id NOT IN (SELECT id FROM public.curator_deals);

UPDATE public.bot_events
   SET song_id = NULL
 WHERE song_id IS NOT NULL
   AND song_id NOT IN (SELECT id FROM public.curator_deal_songs);

DELETE FROM public.curator_fraud_alerts
  WHERE deal_id NOT IN (SELECT id FROM public.curator_deals);

UPDATE public.curator_fraud_alerts
   SET playlist_id = NULL
 WHERE playlist_id IS NOT NULL
   AND playlist_id NOT IN (SELECT id FROM public.curator_playlists);

DELETE FROM public.curator_paste_imports
  WHERE deal_id NOT IN (SELECT id FROM public.curator_deals);

UPDATE public.curator_paste_imports
   SET song_id = NULL
 WHERE song_id IS NOT NULL
   AND song_id NOT IN (SELECT id FROM public.curator_deal_songs);

-- 4) FKs (drop-if-exists para idempotência via DO blocks)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_print_batches_deal_id_fkey'
  ) THEN
    ALTER TABLE public.bot_print_batches
      ADD CONSTRAINT bot_print_batches_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.curator_deals(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_print_batches_song_id_fkey'
  ) THEN
    ALTER TABLE public.bot_print_batches
      ADD CONSTRAINT bot_print_batches_song_id_fkey
      FOREIGN KEY (song_id) REFERENCES public.curator_deal_songs(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_events_deal_id_fkey'
  ) THEN
    ALTER TABLE public.bot_events
      ADD CONSTRAINT bot_events_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.curator_deals(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_events_song_id_fkey'
  ) THEN
    ALTER TABLE public.bot_events
      ADD CONSTRAINT bot_events_song_id_fkey
      FOREIGN KEY (song_id) REFERENCES public.curator_deal_songs(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'curator_fraud_alerts_deal_id_fkey'
  ) THEN
    ALTER TABLE public.curator_fraud_alerts
      ADD CONSTRAINT curator_fraud_alerts_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.curator_deals(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'curator_fraud_alerts_playlist_id_fkey'
  ) THEN
    ALTER TABLE public.curator_fraud_alerts
      ADD CONSTRAINT curator_fraud_alerts_playlist_id_fkey
      FOREIGN KEY (playlist_id) REFERENCES public.curator_playlists(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'curator_paste_imports_deal_id_fkey'
  ) THEN
    ALTER TABLE public.curator_paste_imports
      ADD CONSTRAINT curator_paste_imports_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.curator_deals(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'curator_paste_imports_song_id_fkey'
  ) THEN
    ALTER TABLE public.curator_paste_imports
      ADD CONSTRAINT curator_paste_imports_song_id_fkey
      FOREIGN KEY (song_id) REFERENCES public.curator_deal_songs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 5) Índices de performance nas FKs novas
CREATE INDEX IF NOT EXISTS idx_bot_print_batches_deal_id ON public.bot_print_batches (deal_id);
CREATE INDEX IF NOT EXISTS idx_bot_print_batches_song_id ON public.bot_print_batches (song_id);
CREATE INDEX IF NOT EXISTS idx_bot_events_deal_id ON public.bot_events (deal_id);
CREATE INDEX IF NOT EXISTS idx_bot_events_song_id ON public.bot_events (song_id);
CREATE INDEX IF NOT EXISTS idx_curator_fraud_alerts_deal_id ON public.curator_fraud_alerts (deal_id);
CREATE INDEX IF NOT EXISTS idx_curator_paste_imports_deal_id ON public.curator_paste_imports (deal_id);