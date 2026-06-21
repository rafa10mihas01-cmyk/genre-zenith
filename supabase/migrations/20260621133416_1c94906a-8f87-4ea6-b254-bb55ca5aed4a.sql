
CREATE TABLE IF NOT EXISTS public.oauth_migration_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid NOT NULL REFERENCES public.spotify_user_tokens(id) ON DELETE CASCADE,
  spotify_user_id text NOT NULL,
  current_app_id uuid NOT NULL REFERENCES public.spotify_apps(id),
  target_app_id uuid NOT NULL REFERENCES public.spotify_apps(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  playlists_count integer NOT NULL DEFAULT 0,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  notes text,
  UNIQUE (token_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.oauth_migration_plan TO authenticated;
GRANT ALL ON public.oauth_migration_plan TO service_role;

ALTER TABLE public.oauth_migration_plan ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage oauth_migration_plan"
  ON public.oauth_migration_plan
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_oauth_migration_plan_status ON public.oauth_migration_plan(status, assigned_at DESC);
