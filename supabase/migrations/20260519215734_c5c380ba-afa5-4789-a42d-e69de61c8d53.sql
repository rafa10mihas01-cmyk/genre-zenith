-- Fase 1 — Onboarding Inteligente de Playlists
-- Adições puras (sem DROP, sem ALTER destrutivo).

ALTER TABLE public.managed_playlists
  ADD COLUMN IF NOT EXISTS lifecycle_stage text NOT NULL DEFAULT 'onboarding',
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_ready_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_onboarding_check_at timestamptz;

-- Validação por trigger (CHECK constraint clássico funciona, mas trigger é mais flexível pra evoluir)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'managed_playlists_lifecycle_stage_chk') THEN
    ALTER TABLE public.managed_playlists
      ADD CONSTRAINT managed_playlists_lifecycle_stage_chk
      CHECK (lifecycle_stage IN ('onboarding','testing','mature'));
  END IF;
END $$;

-- Backfill: tudo que já existe vira "mature" pra NÃO disparar onboarding retroativo.
UPDATE public.managed_playlists
SET lifecycle_stage = 'mature',
    onboarding_completed_at = COALESCE(onboarding_completed_at, now())
WHERE lifecycle_stage = 'onboarding'
  AND created_at < now() - interval '1 minute';

CREATE INDEX IF NOT EXISTS idx_managed_playlists_lifecycle
  ON public.managed_playlists (lifecycle_stage)
  WHERE archived_at IS NULL;