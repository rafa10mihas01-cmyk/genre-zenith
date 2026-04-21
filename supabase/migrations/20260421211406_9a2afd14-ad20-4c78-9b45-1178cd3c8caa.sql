ALTER TABLE public.genres
  ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attention_reason TEXT,
  ADD COLUMN IF NOT EXISTS attention_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_audit_metrics JSONB;

CREATE INDEX IF NOT EXISTS idx_genres_needs_attention
  ON public.genres (needs_attention)
  WHERE needs_attention = true;