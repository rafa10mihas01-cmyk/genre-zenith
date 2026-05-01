-- New Curator Deals module tables (additive, alongside existing playlist_deals)

CREATE TABLE public.curator_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  curator_name text NOT NULL,
  song_spotify_url text NOT NULL,
  song_name text NOT NULL,
  song_artist text,
  song_cover_url text,
  target_plays bigint NOT NULL,
  baseline_plays bigint NOT NULL DEFAULT 0,
  cost numeric,
  started_at timestamptz NOT NULL DEFAULT now(),
  public_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.curator_playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.curator_deals(id) ON DELETE CASCADE,
  spotify_url text NOT NULL,
  playlist_name text NOT NULL,
  followers bigint,
  is_baseline boolean NOT NULL DEFAULT false,
  added_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.curator_deal_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.curator_deals(id) ON DELETE CASCADE,
  total_plays bigint NOT NULL,
  note text,
  is_baseline boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_curator_deals_user_id ON public.curator_deals(user_id);
CREATE INDEX idx_curator_deals_public_token ON public.curator_deals(public_token);
CREATE INDEX idx_curator_playlists_deal_id ON public.curator_playlists(deal_id);
CREATE INDEX idx_curator_deal_logs_deal_id ON public.curator_deal_logs(deal_id);

ALTER TABLE public.curator_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curator_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curator_deal_logs ENABLE ROW LEVEL SECURITY;

-- curator_deals: owner full access
CREATE POLICY "Users select own curator_deals"
  ON public.curator_deals FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own curator_deals"
  ON public.curator_deals FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own curator_deals"
  ON public.curator_deals FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own curator_deals"
  ON public.curator_deals FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- curator_playlists: scoped via parent deal ownership
CREATE POLICY "Users select own curator_playlists"
  ON public.curator_playlists FOR SELECT TO authenticated
  USING (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

CREATE POLICY "Users insert own curator_playlists"
  ON public.curator_playlists FOR INSERT TO authenticated
  WITH CHECK (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

CREATE POLICY "Users update own curator_playlists"
  ON public.curator_playlists FOR UPDATE TO authenticated
  USING (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()))
  WITH CHECK (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

CREATE POLICY "Users delete own curator_playlists"
  ON public.curator_playlists FOR DELETE TO authenticated
  USING (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

-- curator_deal_logs: scoped via parent deal ownership
CREATE POLICY "Users select own curator_deal_logs"
  ON public.curator_deal_logs FOR SELECT TO authenticated
  USING (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

CREATE POLICY "Users insert own curator_deal_logs"
  ON public.curator_deal_logs FOR INSERT TO authenticated
  WITH CHECK (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

CREATE POLICY "Users update own curator_deal_logs"
  ON public.curator_deal_logs FOR UPDATE TO authenticated
  USING (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()))
  WITH CHECK (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

CREATE POLICY "Users delete own curator_deal_logs"
  ON public.curator_deal_logs FOR DELETE TO authenticated
  USING (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));