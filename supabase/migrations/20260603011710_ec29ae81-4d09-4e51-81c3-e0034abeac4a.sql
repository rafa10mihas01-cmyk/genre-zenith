DROP INDEX IF EXISTS public.idx_spotify_user_tokens_one_default;
CREATE UNIQUE INDEX idx_spotify_user_tokens_one_default_per_user
  ON public.spotify_user_tokens (spotify_user_id)
  WHERE is_default = true;