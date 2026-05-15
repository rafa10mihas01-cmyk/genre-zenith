
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.external_curators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  spotify_playlist_id TEXT,
  spotify_url TEXT,
  name TEXT NOT NULL,
  owner_name TEXT,
  followers INTEGER DEFAULT 0,
  tracks INTEGER DEFAULT 0,
  track_popularity INTEGER DEFAULT 0,
  activity TEXT,
  last_modified TEXT,
  email TEXT,
  instagram TEXT,
  social TEXT,
  links TEXT,
  description TEXT,
  score TEXT,
  score_raw INTEGER,
  status TEXT NOT NULL DEFAULT 'novo',
  favorite BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX external_curators_user_playlist_uniq
  ON public.external_curators (user_id, spotify_playlist_id)
  WHERE spotify_playlist_id IS NOT NULL;
CREATE INDEX external_curators_user_idx ON public.external_curators (user_id);
CREATE INDEX external_curators_status_idx ON public.external_curators (user_id, status);

ALTER TABLE public.external_curators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_select" ON public.external_curators FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "owner_insert" ON public.external_curators FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_update" ON public.external_curators FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "owner_delete" ON public.external_curators FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER external_curators_set_updated_at
  BEFORE UPDATE ON public.external_curators
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
