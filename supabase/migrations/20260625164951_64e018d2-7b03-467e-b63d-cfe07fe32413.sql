
-- =========================================================
-- FASE 1 — Playlist Occupancy Engine: Políticas Editoriais
-- =========================================================

-- 1) Política editorial por playlist
CREATE TABLE IF NOT EXISTS public.playlist_editorial_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  managed_playlist_id uuid NOT NULL UNIQUE REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  -- Reservas e capacidades
  campaign_reserved_slots integer NOT NULL DEFAULT 18 CHECK (campaign_reserved_slots >= 0),
  catalog_capacity integer NOT NULL DEFAULT 20 CHECK (catalog_capacity >= 0),
  third_party_max_pct numeric(5,2) NOT NULL DEFAULT 20 CHECK (third_party_max_pct >= 0 AND third_party_max_pct <= 100),
  -- Top 10 protegido (decisão: campanha soberana, top10 reservado a campanhas)
  protect_top_n integer NOT NULL DEFAULT 10 CHECK (protect_top_n >= 0),
  -- Intercalação catalogo/terceiros (ex: a cada X catalogo permite 1 terceiro)
  intercalation_ratio integer NOT NULL DEFAULT 4 CHECK (intercalation_ratio >= 1),
  -- Estado
  is_active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','genre_default','seed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.playlist_editorial_policies TO authenticated;
GRANT ALL ON public.playlist_editorial_policies TO service_role;

ALTER TABLE public.playlist_editorial_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read playlist policies"
  ON public.playlist_editorial_policies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage playlist policies"
  ON public.playlist_editorial_policies FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_pep_active ON public.playlist_editorial_policies(is_active) WHERE is_active;

-- 2) Política padrão por gênero (fallback)
CREATE TABLE IF NOT EXISTS public.genre_editorial_policy_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id uuid NOT NULL UNIQUE REFERENCES public.genres(id) ON DELETE CASCADE,
  campaign_reserved_slots integer NOT NULL DEFAULT 18 CHECK (campaign_reserved_slots >= 0),
  catalog_capacity integer NOT NULL DEFAULT 20 CHECK (catalog_capacity >= 0),
  third_party_max_pct numeric(5,2) NOT NULL DEFAULT 20 CHECK (third_party_max_pct >= 0 AND third_party_max_pct <= 100),
  protect_top_n integer NOT NULL DEFAULT 10 CHECK (protect_top_n >= 0),
  intercalation_ratio integer NOT NULL DEFAULT 4 CHECK (intercalation_ratio >= 1),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.genre_editorial_policy_defaults TO authenticated;
GRANT ALL ON public.genre_editorial_policy_defaults TO service_role;

ALTER TABLE public.genre_editorial_policy_defaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read genre policy defaults"
  ON public.genre_editorial_policy_defaults FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage genre policy defaults"
  ON public.genre_editorial_policy_defaults FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3) Alertas operacionais (E5)
CREATE TABLE IF NOT EXISTS public.playlist_policy_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  managed_playlist_id uuid NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN ('policy_missing','policy_invalid','capacity_exceeded','third_party_overflow')),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.playlist_policy_alerts TO authenticated;
GRANT ALL ON public.playlist_policy_alerts TO service_role;

ALTER TABLE public.playlist_policy_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read policy alerts"
  ON public.playlist_policy_alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages policy alerts"
  ON public.playlist_policy_alerts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ppa_open
  ON public.playlist_policy_alerts(managed_playlist_id, alert_type)
  WHERE resolved_at IS NULL;

-- 4) Trigger para updated_at
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_pep_updated_at ON public.playlist_editorial_policies;
CREATE TRIGGER trg_pep_updated_at BEFORE UPDATE ON public.playlist_editorial_policies
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_gepd_updated_at ON public.genre_editorial_policy_defaults;
CREATE TRIGGER trg_gepd_updated_at BEFORE UPDATE ON public.genre_editorial_policy_defaults
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 5) View de classificação de origem das faixas (E4 — hierarquia Campaign > Catalog > ThirdParty)
CREATE OR REPLACE VIEW public.v_playlist_track_origin AS
WITH
campaign_tracks AS (
  SELECT DISTINCT
    mp.id  AS managed_playlist_id,
    mpt.spotify_track_id,
    'Campaign'::text AS origin,
    cpc.campaign_id
  FROM public.managed_playlist_tracks mpt
  JOIN public.managed_playlists mp ON mp.id = mpt.playlist_id
  JOIN public.campaign_playlist_collections cpc
    ON cpc.playlist_id = mp.spotify_playlist_id
),
catalog_tracks AS (
  SELECT DISTINCT
    cp.managed_playlist_id,
    ct.spotify_track_id,
    'Catalog'::text AS origin,
    NULL::uuid AS campaign_id
  FROM public.catalog_placements cp
  JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id
  WHERE cp.status = 'active'
)
SELECT
  mpt.playlist_id AS managed_playlist_id,
  mpt.spotify_track_id,
  mpt.position,
  COALESCE(c.origin, cat.origin, 'ThirdParty') AS origin,
  c.campaign_id
FROM public.managed_playlist_tracks mpt
LEFT JOIN campaign_tracks c
  ON c.managed_playlist_id = mpt.playlist_id
 AND c.spotify_track_id   = mpt.spotify_track_id
LEFT JOIN catalog_tracks cat
  ON cat.managed_playlist_id = mpt.playlist_id
 AND cat.spotify_track_id   = mpt.spotify_track_id;

GRANT SELECT ON public.v_playlist_track_origin TO authenticated, service_role;

-- 6) Helper RPC: resolve política efetiva (playlist > genero > NULL)
CREATE OR REPLACE FUNCTION public.fn_resolve_playlist_policy(p_playlist_id uuid)
RETURNS TABLE (
  managed_playlist_id uuid,
  campaign_reserved_slots integer,
  catalog_capacity integer,
  third_party_max_pct numeric,
  protect_top_n integer,
  intercalation_ratio integer,
  source text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    mp.id,
    COALESCE(pep.campaign_reserved_slots, gepd.campaign_reserved_slots),
    COALESCE(pep.catalog_capacity,        gepd.catalog_capacity),
    COALESCE(pep.third_party_max_pct,     gepd.third_party_max_pct),
    COALESCE(pep.protect_top_n,           gepd.protect_top_n),
    COALESCE(pep.intercalation_ratio,     gepd.intercalation_ratio),
    CASE
      WHEN pep.id  IS NOT NULL THEN 'playlist'
      WHEN gepd.id IS NOT NULL THEN 'genre_default'
      ELSE 'missing'
    END
  FROM public.managed_playlists mp
  LEFT JOIN public.playlist_editorial_policies pep
    ON pep.managed_playlist_id = mp.id AND pep.is_active
  LEFT JOIN public.genre_editorial_policy_defaults gepd
    ON gepd.genre_id = mp.genre_id
  WHERE mp.id = p_playlist_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_resolve_playlist_policy(uuid) TO authenticated, service_role;
