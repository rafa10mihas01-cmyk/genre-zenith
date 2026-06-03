CREATE INDEX IF NOT EXISTS idx_curator_deal_songs_deal_id
  ON public.curator_deal_songs (deal_id);

CREATE INDEX IF NOT EXISTS idx_curator_deals_campaign_id
  ON public.curator_deals (campaign_id) WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_curator_deals_user_id
  ON public.curator_deals (user_id);

CREATE INDEX IF NOT EXISTS idx_curator_deals_curator_id
  ON public.curator_deals (curator_id) WHERE curator_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_managed_playlists_curator_id
  ON public.managed_playlists (curator_id);

CREATE INDEX IF NOT EXISTS idx_managed_playlists_spotify_playlist_id
  ON public.managed_playlists (spotify_playlist_id);

CREATE INDEX IF NOT EXISTS idx_campaign_allocations_campaign_id
  ON public.campaign_allocations (campaign_id);

CREATE INDEX IF NOT EXISTS idx_curators_user_id
  ON public.curators (user_id);

CREATE INDEX IF NOT EXISTS idx_clients_user_id
  ON public.clients (user_id);

ANALYZE public.curator_deal_songs;
ANALYZE public.curator_deals;
ANALYZE public.managed_playlists;
ANALYZE public.campaign_allocations;
ANALYZE public.curators;
ANALYZE public.clients;