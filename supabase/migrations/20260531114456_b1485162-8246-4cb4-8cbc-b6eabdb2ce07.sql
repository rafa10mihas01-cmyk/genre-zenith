
CREATE TABLE public.song_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id UUID NOT NULL,
  spotify_song_id TEXT,
  correlation_id TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  time_window TEXT NOT NULL DEFAULT '7d',
  total_plays_28d BIGINT,
  screenshot_url TEXT,
  bot_metadata JSONB DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_song_snapshots_song_id ON public.song_snapshots(song_id, captured_at DESC);
CREATE INDEX idx_song_snapshots_unprocessed ON public.song_snapshots(captured_at) WHERE processed_at IS NULL;
CREATE INDEX idx_song_snapshots_correlation ON public.song_snapshots(correlation_id) WHERE correlation_id IS NOT NULL;

CREATE TABLE public.song_snapshot_playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES public.song_snapshots(id) ON DELETE CASCADE,
  spotify_playlist_id TEXT,
  name TEXT NOT NULL,
  owner TEXT,
  plays_7d BIGINT,
  position INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_snapshot_playlists_snapshot ON public.song_snapshot_playlists(snapshot_id);
CREATE INDEX idx_snapshot_playlists_spotify_id ON public.song_snapshot_playlists(spotify_playlist_id) WHERE spotify_playlist_id IS NOT NULL;

GRANT ALL ON public.song_snapshots TO service_role;
GRANT ALL ON public.song_snapshot_playlists TO service_role;

ALTER TABLE public.song_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.song_snapshot_playlists ENABLE ROW LEVEL SECURITY;
