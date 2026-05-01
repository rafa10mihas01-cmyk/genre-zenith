-- 1) Adiciona ends_at em curator_deals
ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS ends_at timestamp with time zone;

-- 2) Nova tabela: curator_deal_songs
CREATE TABLE IF NOT EXISTS public.curator_deal_songs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES public.curator_deals(id) ON DELETE CASCADE,
  song_spotify_url text NOT NULL,
  spotify_track_id text,
  song_name text NOT NULL,
  song_artist text,
  song_cover_url text,
  daily_goal bigint NOT NULL DEFAULT 0,
  target_plays bigint,
  baseline_plays bigint NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_curator_deal_songs_deal_id
  ON public.curator_deal_songs(deal_id);

ALTER TABLE public.curator_deal_songs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own curator_deal_songs" ON public.curator_deal_songs;
CREATE POLICY "Users select own curator_deal_songs"
  ON public.curator_deal_songs FOR SELECT
  TO authenticated
  USING (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users insert own curator_deal_songs" ON public.curator_deal_songs;
CREATE POLICY "Users insert own curator_deal_songs"
  ON public.curator_deal_songs FOR INSERT
  TO authenticated
  WITH CHECK (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users update own curator_deal_songs" ON public.curator_deal_songs;
CREATE POLICY "Users update own curator_deal_songs"
  ON public.curator_deal_songs FOR UPDATE
  TO authenticated
  USING (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()))
  WITH CHECK (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users delete own curator_deal_songs" ON public.curator_deal_songs;
CREATE POLICY "Users delete own curator_deal_songs"
  ON public.curator_deal_songs FOR DELETE
  TO authenticated
  USING (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

DROP TRIGGER IF EXISTS trg_curator_deal_songs_touch ON public.curator_deal_songs;
CREATE TRIGGER trg_curator_deal_songs_touch
  BEFORE UPDATE ON public.curator_deal_songs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) Vincula logs e playlists à música (opcional)
ALTER TABLE public.curator_deal_logs
  ADD COLUMN IF NOT EXISTS song_id uuid REFERENCES public.curator_deal_songs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_curator_deal_logs_song_id
  ON public.curator_deal_logs(song_id);

ALTER TABLE public.curator_playlists
  ADD COLUMN IF NOT EXISTS song_id uuid REFERENCES public.curator_deal_songs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_curator_playlists_song_id
  ON public.curator_playlists(song_id);