
-- 1. Triggers fantasma (chamam sync_deal_campaign_baseline, que não existe)
DROP TRIGGER IF EXISTS trg_sync_baseline_on_deal_insert ON public.curator_deals;
DROP TRIGGER IF EXISTS trg_sync_baseline_on_song_insert ON public.curator_deal_songs;
DROP FUNCTION IF EXISTS public._trg_sync_baseline_on_deal_insert();
DROP FUNCTION IF EXISTS public._trg_sync_baseline_on_song_insert();

-- 2. enforce_curator_playlist_initial_roster — no-op + bug de coluna
DROP TRIGGER IF EXISTS trg_enforce_curator_playlist_initial_roster ON public.curator_playlists;
DROP FUNCTION IF EXISTS public.enforce_curator_playlist_initial_roster();

-- 3. Trigger duplicada antiga em campaigns (mantém tg_campaigns_enqueue_baseline -> _fn)
DROP TRIGGER IF EXISTS campaigns_enqueue_baseline ON public.campaigns;
DROP FUNCTION IF EXISTS public.tg_campaigns_enqueue_baseline();
