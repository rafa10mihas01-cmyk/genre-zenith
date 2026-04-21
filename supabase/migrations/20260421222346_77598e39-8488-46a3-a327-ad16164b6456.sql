-- Track Spotify creation results on playlist_templates
ALTER TABLE public.playlist_templates
  ADD COLUMN IF NOT EXISTS spotify_playlist_id text,
  ADD COLUMN IF NOT EXISTS spotify_url text,
  ADD COLUMN IF NOT EXISTS spotify_snapshot_id text,
  ADD COLUMN IF NOT EXISTS spotify_owner_id text,
  ADD COLUMN IF NOT EXISTS tracks_added integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tracks_failed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS creation_error text,
  ADD COLUMN IF NOT EXISTS created_on_spotify_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_playlist_templates_spotify_id
  ON public.playlist_templates (spotify_playlist_id);

-- Store user-authorized OAuth tokens (refresh_token enables long-lived access)
CREATE TABLE IF NOT EXISTS public.spotify_user_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_user_id text NOT NULL UNIQUE,
  display_name text,
  email text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  scope text,
  expires_at timestamptz NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.spotify_user_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_spotify_user_tokens" ON public.spotify_user_tokens
  FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_spotify_user_tokens" ON public.spotify_user_tokens
  FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_spotify_user_tokens" ON public.spotify_user_tokens
  FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_spotify_user_tokens" ON public.spotify_user_tokens
  FOR DELETE TO authenticated USING (has_team_access());

CREATE TRIGGER spotify_user_tokens_touch_updated_at
  BEFORE UPDATE ON public.spotify_user_tokens
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();