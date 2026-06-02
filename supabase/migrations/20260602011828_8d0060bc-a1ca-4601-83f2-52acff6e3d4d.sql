-- Auditoria persistente do fluxo OAuth Spotify
CREATE TABLE public.spotify_oauth_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL CHECK (event IN (
    'invite_created',
    'invite_opened',
    'login_started',
    'callback_received',
    'token_exchanged',
    'account_connected',
    'failure'
  )),
  flow text CHECK (flow IN ('invite', 'admin', 'public')),
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
  error_code text,
  error_message text,
  state text,
  invite_token text,
  app_id uuid REFERENCES public.spotify_apps(id) ON DELETE SET NULL,
  spotify_user_id text,
  email text,
  display_name text,
  actor_user_id uuid,
  ip text,
  user_agent text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT SELECT ON public.spotify_oauth_audit TO authenticated;
GRANT ALL ON public.spotify_oauth_audit TO service_role;

ALTER TABLE public.spotify_oauth_audit ENABLE ROW LEVEL SECURITY;

-- Apenas admins leem
CREATE POLICY "Admins can read spotify oauth audit"
ON public.spotify_oauth_audit
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Gravação só via service_role (Edge Functions). Sem policy de INSERT
-- pra authenticated/anon — service_role bypassa RLS por padrão.

CREATE INDEX idx_spotify_oauth_audit_created_at ON public.spotify_oauth_audit (created_at DESC);
CREATE INDEX idx_spotify_oauth_audit_event ON public.spotify_oauth_audit (event);
CREATE INDEX idx_spotify_oauth_audit_invite_token ON public.spotify_oauth_audit (invite_token) WHERE invite_token IS NOT NULL;
CREATE INDEX idx_spotify_oauth_audit_state ON public.spotify_oauth_audit (state) WHERE state IS NOT NULL;
CREATE INDEX idx_spotify_oauth_audit_app_id ON public.spotify_oauth_audit (app_id) WHERE app_id IS NOT NULL;
CREATE INDEX idx_spotify_oauth_audit_status ON public.spotify_oauth_audit (status) WHERE status = 'error';