CREATE TABLE IF NOT EXISTS public.delivery_proofs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id              uuid NOT NULL REFERENCES public.curator_deals(id) ON DELETE CASCADE,
  song_id              uuid NOT NULL REFERENCES public.curator_deal_songs(id) ON DELETE CASCADE,
  playlist_id          uuid NOT NULL REFERENCES public.curator_playlists(id) ON DELETE CASCADE,
  spotify_playlist_id  text NOT NULL,
  playlist_name        text NOT NULL,
  track_name           text NOT NULL,
  plays_total          bigint NOT NULL,
  plays_24h            integer,
  plays_7d             integer,
  position_in_playlist integer,
  source               text NOT NULL DEFAULT 'dom',
  screenshot_url       text,
  bot_correlation_id   text,
  captured_at          timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.delivery_proofs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_select_proofs" ON public.delivery_proofs;
CREATE POLICY "team_select_proofs" ON public.delivery_proofs
  FOR SELECT TO authenticated USING (has_team_access());

DROP POLICY IF EXISTS "service_insert_proofs" ON public.delivery_proofs;
CREATE POLICY "service_insert_proofs" ON public.delivery_proofs
  FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_delivery_proofs_deal
  ON public.delivery_proofs(deal_id, captured_at DESC);