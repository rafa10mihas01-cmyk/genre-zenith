-- ============================================================
-- Playlist Deals — tabelas + RLS
-- ============================================================

CREATE TABLE public.playlist_deals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  song        text NOT NULL,
  playlist    text NOT NULL,
  spotify_url text,
  curator     text,
  target      bigint NOT NULL,
  start_plays bigint NOT NULL DEFAULT 0,
  cost        numeric,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_playlist_deals_user_id    ON public.playlist_deals(user_id);
CREATE INDEX idx_playlist_deals_created_at ON public.playlist_deals(created_at DESC);

ALTER TABLE public.playlist_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own playlist_deals"
  ON public.playlist_deals
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own playlist_deals"
  ON public.playlist_deals
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own playlist_deals"
  ON public.playlist_deals
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own playlist_deals"
  ON public.playlist_deals
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Logs
-- ------------------------------------------------------------

CREATE TABLE public.playlist_deal_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    uuid NOT NULL REFERENCES public.playlist_deals(id) ON DELETE CASCADE,
  count      bigint NOT NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_playlist_deal_logs_deal_id    ON public.playlist_deal_logs(deal_id);
CREATE INDEX idx_playlist_deal_logs_created_at ON public.playlist_deal_logs(created_at DESC);

ALTER TABLE public.playlist_deal_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own playlist_deal_logs"
  ON public.playlist_deal_logs
  FOR SELECT TO authenticated
  USING (
    deal_id IN (SELECT id FROM public.playlist_deals WHERE user_id = auth.uid())
  );

CREATE POLICY "Users insert own playlist_deal_logs"
  ON public.playlist_deal_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    deal_id IN (SELECT id FROM public.playlist_deals WHERE user_id = auth.uid())
  );

CREATE POLICY "Users update own playlist_deal_logs"
  ON public.playlist_deal_logs
  FOR UPDATE TO authenticated
  USING (
    deal_id IN (SELECT id FROM public.playlist_deals WHERE user_id = auth.uid())
  )
  WITH CHECK (
    deal_id IN (SELECT id FROM public.playlist_deals WHERE user_id = auth.uid())
  );

CREATE POLICY "Users delete own playlist_deal_logs"
  ON public.playlist_deal_logs
  FOR DELETE TO authenticated
  USING (
    deal_id IN (SELECT id FROM public.playlist_deals WHERE user_id = auth.uid())
  );