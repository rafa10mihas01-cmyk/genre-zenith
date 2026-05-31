
-- 1) Tabela única de coletas (fatos imutáveis do Spotify for Artists)
CREATE TABLE public.campaign_playlist_collections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  playlist_id TEXT NOT NULL,
  playlist_url TEXT,
  playlist_name_at_capture TEXT,
  plays_7d BIGINT NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_baseline BOOLEAN NOT NULL DEFAULT false,
  first_seen_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 's4a_dom',
  proof_screenshot_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_playlist_collections TO authenticated;
GRANT ALL ON public.campaign_playlist_collections TO service_role;

ALTER TABLE public.campaign_playlist_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team can read collections"
  ON public.campaign_playlist_collections FOR SELECT TO authenticated
  USING (public.has_team_access());
CREATE POLICY "team can insert collections"
  ON public.campaign_playlist_collections FOR INSERT TO authenticated
  WITH CHECK (public.has_team_access());
CREATE POLICY "team can update collections"
  ON public.campaign_playlist_collections FOR UPDATE TO authenticated
  USING (public.has_team_access());
CREATE POLICY "team can delete collections"
  ON public.campaign_playlist_collections FOR DELETE TO authenticated
  USING (public.has_team_access());

CREATE INDEX idx_cpc_campaign_playlist_captured
  ON public.campaign_playlist_collections (campaign_id, playlist_id, captured_at DESC);

CREATE UNIQUE INDEX idx_cpc_baseline_unique
  ON public.campaign_playlist_collections (campaign_id, playlist_id)
  WHERE is_baseline = true;

CREATE OR REPLACE FUNCTION public.set_collection_first_seen_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prior_first_seen TIMESTAMPTZ;
BEGIN
  SELECT MIN(first_seen_at) INTO prior_first_seen
  FROM public.campaign_playlist_collections
  WHERE campaign_id = NEW.campaign_id
    AND playlist_id = NEW.playlist_id;

  IF prior_first_seen IS NULL THEN
    NEW.first_seen_at := COALESCE(NEW.first_seen_at, NEW.captured_at, now());
  ELSE
    NEW.first_seen_at := prior_first_seen;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cpc_first_seen
  BEFORE INSERT ON public.campaign_playlist_collections
  FOR EACH ROW EXECUTE FUNCTION public.set_collection_first_seen_at();


-- 2) Cadastros de playlist por curador
CREATE TABLE public.curator_campaign_playlists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  curator_id UUID NOT NULL REFERENCES public.curators(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES public.curator_deals(id) ON DELETE SET NULL,
  playlist_id TEXT NOT NULL,
  playlist_url TEXT NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending_match'
    CHECK (status IN ('pending_match','matched','not_found_yet')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, playlist_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.curator_campaign_playlists TO authenticated;
GRANT ALL ON public.curator_campaign_playlists TO service_role;

ALTER TABLE public.curator_campaign_playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team can read ccp"
  ON public.curator_campaign_playlists FOR SELECT TO authenticated
  USING (public.has_team_access());
CREATE POLICY "curator reads own ccp"
  ON public.curator_campaign_playlists FOR SELECT TO authenticated
  USING (curator_id IN (SELECT id FROM public.curators WHERE user_id = auth.uid()));
CREATE POLICY "team can insert ccp"
  ON public.curator_campaign_playlists FOR INSERT TO authenticated
  WITH CHECK (public.has_team_access());
CREATE POLICY "curator inserts own ccp"
  ON public.curator_campaign_playlists FOR INSERT TO authenticated
  WITH CHECK (curator_id IN (SELECT id FROM public.curators WHERE user_id = auth.uid()));
CREATE POLICY "team can update ccp"
  ON public.curator_campaign_playlists FOR UPDATE TO authenticated
  USING (public.has_team_access());
CREATE POLICY "curator updates own ccp"
  ON public.curator_campaign_playlists FOR UPDATE TO authenticated
  USING (curator_id IN (SELECT id FROM public.curators WHERE user_id = auth.uid()));
CREATE POLICY "team can delete ccp"
  ON public.curator_campaign_playlists FOR DELETE TO authenticated
  USING (public.has_team_access());

CREATE INDEX idx_ccp_campaign ON public.curator_campaign_playlists (campaign_id);
CREATE INDEX idx_ccp_curator ON public.curator_campaign_playlists (curator_id);
CREATE INDEX idx_ccp_playlist ON public.curator_campaign_playlists (campaign_id, playlist_id);

CREATE OR REPLACE FUNCTION public.block_baseline_playlist_registration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.campaign_playlist_collections
    WHERE campaign_id = NEW.campaign_id
      AND playlist_id = NEW.playlist_id
      AND is_baseline = true
  ) THEN
    RAISE EXCEPTION 'baseline_playlist_locked: essa playlist já estava na foto inicial da campanha'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ccp_block_baseline
  BEFORE INSERT ON public.curator_campaign_playlists
  FOR EACH ROW EXECUTE FUNCTION public.block_baseline_playlist_registration();

CREATE TRIGGER trg_ccp_updated_at
  BEFORE UPDATE ON public.curator_campaign_playlists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- 3) Campos novos em campaigns
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS baseline_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (baseline_status IN ('pending','captured','failed')),
  ADD COLUMN IF NOT EXISTS baseline_captured_at TIMESTAMPTZ;


-- 4) View de crescimento (atribuição + delta em runtime)
CREATE OR REPLACE VIEW public.vw_campaign_playlist_growth AS
WITH baseline AS (
  SELECT campaign_id, playlist_id, plays_7d AS baseline_plays,
         playlist_name_at_capture AS baseline_name,
         captured_at AS baseline_at,
         first_seen_at
  FROM public.campaign_playlist_collections
  WHERE is_baseline = true
),
latest AS (
  SELECT DISTINCT ON (campaign_id, playlist_id)
    campaign_id, playlist_id, plays_7d AS current_plays,
    playlist_name_at_capture AS current_name,
    playlist_url, captured_at AS last_captured_at
  FROM public.campaign_playlist_collections
  ORDER BY campaign_id, playlist_id, captured_at DESC
),
all_ids AS (
  SELECT DISTINCT campaign_id, playlist_id FROM public.campaign_playlist_collections
),
eco AS (
  SELECT a.campaign_id, mp.spotify_playlist_id AS playlist_id
  FROM public.campaign_eco_allocations a
  JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
  WHERE mp.spotify_playlist_id IS NOT NULL
),
curator_reg AS (
  SELECT campaign_id, playlist_id, curator_id
  FROM public.curator_campaign_playlists
)
SELECT
  ai.campaign_id,
  ai.playlist_id,
  l.playlist_url,
  l.current_name,
  b.baseline_name,
  b.baseline_plays,
  l.current_plays,
  (COALESCE(l.current_plays, 0) - COALESCE(b.baseline_plays, 0)) AS delta,
  b.baseline_at,
  l.last_captured_at,
  b.first_seen_at,
  CASE
    WHEN cr.curator_id IS NOT NULL THEN 'curator:' || cr.curator_id::text
    WHEN eco.playlist_id IS NOT NULL THEN 'ecosystem'
    ELSE 'organic'
  END AS attributed_to,
  cr.curator_id AS attributed_curator_id
FROM all_ids ai
LEFT JOIN baseline b ON b.campaign_id = ai.campaign_id AND b.playlist_id = ai.playlist_id
LEFT JOIN latest l ON l.campaign_id = ai.campaign_id AND l.playlist_id = ai.playlist_id
LEFT JOIN curator_reg cr ON cr.campaign_id = ai.campaign_id AND cr.playlist_id = ai.playlist_id
LEFT JOIN eco ON eco.campaign_id = ai.campaign_id AND eco.playlist_id = ai.playlist_id;

GRANT SELECT ON public.vw_campaign_playlist_growth TO authenticated, service_role;
