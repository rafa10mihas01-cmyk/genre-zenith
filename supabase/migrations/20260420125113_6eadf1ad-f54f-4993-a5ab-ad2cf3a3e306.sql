CREATE TABLE IF NOT EXISTS public.spotify_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.spotify_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_spotify_tokens" ON public.spotify_tokens
  FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_spotify_tokens" ON public.spotify_tokens
  FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_spotify_tokens" ON public.spotify_tokens
  FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_spotify_tokens" ON public.spotify_tokens
  FOR DELETE TO authenticated USING (public.has_team_access());

CREATE INDEX IF NOT EXISTS idx_spotify_tokens_expires ON public.spotify_tokens(expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_results_pending_enrich ON public.search_results(genre_id) WHERE seguidores IS NULL;