ALTER TABLE public.curators ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_curators_paused ON public.curators (user_id) WHERE paused_at IS NOT NULL;