CREATE TYPE public.organic_play_kind AS ENUM ('algorithmic', 'organic', 'editorial');

CREATE TABLE public.organic_plays_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id UUID NOT NULL REFERENCES public.curator_deals(id) ON DELETE CASCADE,
  song_id UUID REFERENCES public.curator_deal_songs(id) ON DELETE SET NULL,
  spotify_track_id TEXT,
  spotify_playlist_id TEXT,
  playlist_name TEXT,
  kind public.organic_play_kind NOT NULL DEFAULT 'algorithmic',
  plays_24h INTEGER,
  plays_7d INTEGER,
  plays_28d INTEGER,
  source TEXT,
  correlation_id TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_organic_plays_deal_captured
  ON public.organic_plays_snapshots(deal_id, captured_at DESC);
CREATE INDEX idx_organic_plays_song_captured
  ON public.organic_plays_snapshots(song_id, captured_at DESC);
CREATE INDEX idx_organic_plays_playlist
  ON public.organic_plays_snapshots(spotify_playlist_id);

ALTER TABLE public.organic_plays_snapshots ENABLE ROW LEVEL SECURITY;

-- Insert: somente service role (edge functions bypassam RLS).
-- Leitura: admins.
CREATE POLICY "Admins can read organic plays"
ON public.organic_plays_snapshots
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));