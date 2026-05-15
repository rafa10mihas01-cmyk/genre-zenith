
CREATE TABLE IF NOT EXISTS public.spotify_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_id text NOT NULL,
  client_secret text NOT NULL,
  max_accounts int NOT NULL DEFAULT 25,
  status text NOT NULL DEFAULT 'active',
  is_default boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS spotify_apps_client_id_uniq ON public.spotify_apps(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS spotify_apps_one_default ON public.spotify_apps(is_default) WHERE is_default = true;

ALTER TABLE public.spotify_apps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "spotify_apps admin select" ON public.spotify_apps;
CREATE POLICY "spotify_apps admin select" ON public.spotify_apps
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "spotify_apps admin write" ON public.spotify_apps;
CREATE POLICY "spotify_apps admin write" ON public.spotify_apps
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS update_spotify_apps_updated_at ON public.spotify_apps;
CREATE TRIGGER update_spotify_apps_updated_at
  BEFORE UPDATE ON public.spotify_apps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.spotify_user_tokens ADD COLUMN IF NOT EXISTS app_id uuid REFERENCES public.spotify_apps(id) ON DELETE SET NULL;
ALTER TABLE public.spotify_tokens      ADD COLUMN IF NOT EXISTS app_id uuid REFERENCES public.spotify_apps(id) ON DELETE SET NULL;
ALTER TABLE public.spotify_oauth_states ADD COLUMN IF NOT EXISTS app_id uuid REFERENCES public.spotify_apps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS spotify_user_tokens_app_id_idx ON public.spotify_user_tokens(app_id);
CREATE INDEX IF NOT EXISTS spotify_tokens_app_id_idx ON public.spotify_tokens(app_id);

CREATE OR REPLACE FUNCTION public.pick_next_account(p_purpose text DEFAULT 'playlist', p_app_id uuid DEFAULT NULL)
RETURNS TABLE(account_id uuid, spotify_user_id text, app_id uuid, slots_remaining int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    a.id AS account_id,
    a.spotify_user_id,
    sut.app_id,
    (a.max_playlists - a.current_playlists) AS slots_remaining
  FROM public.accounts a
  LEFT JOIN public.spotify_user_tokens sut ON sut.spotify_user_id = a.spotify_user_id
  WHERE a.status = 'active'
    AND a.current_playlists < a.max_playlists
    AND (p_app_id IS NULL OR sut.app_id = p_app_id)
  ORDER BY (a.max_playlists - a.current_playlists) DESC, a.updated_at ASC
  LIMIT 1;
$$;
