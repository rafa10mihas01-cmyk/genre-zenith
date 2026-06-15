CREATE TABLE public.playlists_to_observe (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  name TEXT,
  curator_id UUID REFERENCES public.curators(id) ON DELETE SET NULL,
  curator_name TEXT,
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.playlist_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES public.playlists_to_observe(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  observed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.observer_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  playlists_processed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running',
  error TEXT
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.playlists_to_observe TO authenticated;
GRANT ALL ON public.playlists_to_observe TO service_role;
GRANT SELECT, INSERT ON public.playlist_observations TO authenticated;
GRANT ALL ON public.playlist_observations TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.observer_runs TO authenticated;
GRANT ALL ON public.observer_runs TO service_role;

ALTER TABLE public.playlists_to_observe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observer_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active playlists" ON public.playlists_to_observe FOR SELECT USING (true);
CREATE POLICY "Authenticated users can manage playlists" ON public.playlists_to_observe FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can read observations" ON public.playlist_observations FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert observations" ON public.playlist_observations FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read runs" ON public.observer_runs FOR SELECT USING (true);
CREATE POLICY "Authenticated users can manage runs" ON public.observer_runs FOR ALL USING (true) WITH CHECK (true);