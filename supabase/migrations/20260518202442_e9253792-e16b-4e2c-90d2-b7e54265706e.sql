
-- 1. Snapshots Eco reais por campanha × playlist própria
CREATE TABLE IF NOT EXISTS public.campaign_eco_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  managed_playlist_id uuid NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  spotify_playlist_id text NOT NULL,
  plays_24h bigint,
  plays_7d bigint,
  plays_28d bigint,
  captured_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'spotify_for_artists_dom',
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ces_campaign ON public.campaign_eco_snapshots(campaign_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ces_playlist ON public.campaign_eco_snapshots(managed_playlist_id, captured_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ces_unique ON public.campaign_eco_snapshots(campaign_id, managed_playlist_id, captured_at);

ALTER TABLE public.campaign_eco_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_select_ces ON public.campaign_eco_snapshots
  FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY team_insert_ces ON public.campaign_eco_snapshots
  FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY team_update_ces ON public.campaign_eco_snapshots
  FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY team_delete_ces ON public.campaign_eco_snapshots
  FOR DELETE TO authenticated USING (public.has_team_access());

-- 2. Linkar curator_deals a campanha (shadow deals)
ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_curator_deals_campaign ON public.curator_deals(campaign_id) WHERE campaign_id IS NOT NULL;

-- 3. Trigger: ao ativar campanha, criar shadow deal + song
CREATE OR REPLACE FUNCTION public.tg_campaign_shadow_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id uuid;
  v_existing uuid;
BEGIN
  -- só age em transições para active/dispatched
  IF NEW.status NOT IN ('active', 'dispatched') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.spotify_track_id IS NULL OR NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  -- já existe shadow deal pra essa campanha?
  SELECT id INTO v_existing FROM public.curator_deals WHERE campaign_id = NEW.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- cria shadow deal
  INSERT INTO public.curator_deals (
    user_id, curator_name, song_spotify_url, song_name, song_artist,
    target_plays, baseline_plays, cost, started_at, state, source, campaign_id
  ) VALUES (
    NEW.created_by,
    'Eco Interno (campanha)',
    COALESCE(NEW.spotify_track_url, 'spotify:track:' || NEW.spotify_track_id),
    NEW.track_name,
    NEW.artist,
    COALESCE(NEW.goal_plays, 0),
    0,
    0,
    now(),
    'active',
    'campaign_internal',
    NEW.id
  )
  RETURNING id INTO v_deal_id;

  -- cria shadow song (entra na fila do bot)
  INSERT INTO public.curator_deal_songs (
    deal_id, spotify_track_id, song_spotify_url, song_name, song_artist,
    auto_collect, auto_collect_interval_minutes, auto_collect_status, position, started_at
  ) VALUES (
    v_deal_id,
    NEW.spotify_track_id,
    COALESCE(NEW.spotify_track_url, 'spotify:track:' || NEW.spotify_track_id),
    NEW.track_name,
    NEW.artist,
    true,
    1440,
    'idle',
    1,
    now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaign_shadow_deal ON public.campaigns;
CREATE TRIGGER trg_campaign_shadow_deal
  AFTER INSERT OR UPDATE OF status ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.tg_campaign_shadow_deal();

-- 4. Trigger: ao encerrar campanha, fecha shadow deal
CREATE OR REPLACE FUNCTION public.tg_campaign_shadow_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('completed', 'cancelled') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.curator_deals
       SET state = 'closed', closed_at = COALESCE(closed_at, now())
     WHERE campaign_id = NEW.id AND closed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaign_shadow_close ON public.campaigns;
CREATE TRIGGER trg_campaign_shadow_close
  AFTER UPDATE OF status ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.tg_campaign_shadow_close();

-- 5. Backfill: para campanhas já ativas, gera shadow
DO $$
DECLARE r record; v_deal_id uuid;
BEGIN
  FOR r IN
    SELECT c.* FROM public.campaigns c
    LEFT JOIN public.curator_deals d ON d.campaign_id = c.id
    WHERE c.status IN ('active', 'dispatched')
      AND c.spotify_track_id IS NOT NULL
      AND c.created_by IS NOT NULL
      AND d.id IS NULL
  LOOP
    INSERT INTO public.curator_deals (
      user_id, curator_name, song_spotify_url, song_name, song_artist,
      target_plays, baseline_plays, cost, started_at, state, source, campaign_id
    ) VALUES (
      r.created_by, 'Eco Interno (campanha)',
      COALESCE(r.spotify_track_url, 'spotify:track:' || r.spotify_track_id),
      r.track_name, r.artist, COALESCE(r.goal_plays, 0), 0, 0, now(),
      'active', 'campaign_internal', r.id
    ) RETURNING id INTO v_deal_id;

    INSERT INTO public.curator_deal_songs (
      deal_id, spotify_track_id, song_spotify_url, song_name, song_artist,
      auto_collect, auto_collect_interval_minutes, auto_collect_status, position, started_at
    ) VALUES (
      v_deal_id, r.spotify_track_id,
      COALESCE(r.spotify_track_url, 'spotify:track:' || r.spotify_track_id),
      r.track_name, r.artist, true, 1440, 'idle', 1, now()
    );
  END LOOP;
END $$;
