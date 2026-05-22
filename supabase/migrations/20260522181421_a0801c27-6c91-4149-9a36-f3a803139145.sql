
CREATE TABLE public.spotify_invite_tokens (
  token text PRIMARY KEY,
  app_id uuid NOT NULL REFERENCES public.spotify_apps(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  label text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_spotify_user_id text,
  consumed_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX spotify_invite_tokens_app_idx ON public.spotify_invite_tokens(app_id);

ALTER TABLE public.spotify_invite_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_spotify_invite_tokens" ON public.spotify_invite_tokens
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
