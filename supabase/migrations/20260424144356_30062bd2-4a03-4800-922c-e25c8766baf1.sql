-- =========================================================
-- AUDIT #8 B.2 — Singleton em spotify_tokens (race condition)
-- =========================================================
ALTER TABLE public.spotify_tokens
  ADD COLUMN IF NOT EXISTS singleton_key text NOT NULL DEFAULT 'app';

-- Mantém só o token mais novo antes de aplicar UNIQUE
DELETE FROM public.spotify_tokens a
 USING public.spotify_tokens b
 WHERE a.id <> b.id
   AND a.expires_at < b.expires_at;

CREATE UNIQUE INDEX IF NOT EXISTS idx_spotify_tokens_singleton
  ON public.spotify_tokens (singleton_key);