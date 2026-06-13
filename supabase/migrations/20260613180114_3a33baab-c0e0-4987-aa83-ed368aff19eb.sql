-- =====================================================================
-- FASE 0 — Esteira de Catálogo (schema base, separada de campanhas)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ALTER managed_playlists: 2 colunas novas + backfill
-- ---------------------------------------------------------------------
ALTER TABLE public.managed_playlists
  ADD COLUMN IF NOT EXISTS is_catalog boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catalog_capacity integer NOT NULL DEFAULT 20;

-- Backfill: marca TODAS as playlists (ativas + as 525 arquivadas) como catálogo.
-- archived_at é preservado — campanhas continuam filtrando archived_at IS NULL.
UPDATE public.managed_playlists
SET is_catalog = true,
    catalog_capacity = 20
WHERE is_catalog = false;

-- Partial index pro lookup do distribuidor.
CREATE INDEX IF NOT EXISTS idx_managed_playlists_is_catalog
  ON public.managed_playlists (id)
  WHERE is_catalog = true;

-- ---------------------------------------------------------------------
-- 2. Função genérica updated_at (idempotente)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. catalog_tracks — música única no catálogo
-- ---------------------------------------------------------------------
CREATE TABLE public.catalog_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_track_id text NOT NULL,
  spotify_uri text,
  isrc text,
  track_name text NOT NULL,
  artist_name text NOT NULL,
  cover_url text,
  added_by uuid,
  added_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_tracks_spotify_track_id_key UNIQUE (spotify_track_id),
  CONSTRAINT catalog_tracks_status_check CHECK (status IN ('active','paused','removed'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_tracks TO authenticated;
GRANT ALL ON public.catalog_tracks TO service_role;

ALTER TABLE public.catalog_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access_catalog_tracks"
  ON public.catalog_tracks
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_catalog_tracks_status ON public.catalog_tracks (status);
CREATE INDEX idx_catalog_tracks_isrc ON public.catalog_tracks (isrc) WHERE isrc IS NOT NULL;

CREATE TRIGGER trg_catalog_tracks_updated_at
  BEFORE UPDATE ON public.catalog_tracks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 4. catalog_track_baselines — T0 imutável por música
-- ---------------------------------------------------------------------
CREATE TABLE public.catalog_track_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_track_id uuid NOT NULL REFERENCES public.catalog_tracks(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  streams bigint,
  popularity integer,
  monthly_listeners bigint,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_track_baselines_track_unique UNIQUE (catalog_track_id),
  CONSTRAINT catalog_track_baselines_popularity_check CHECK (popularity IS NULL OR (popularity BETWEEN 0 AND 100))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_track_baselines TO authenticated;
GRANT ALL ON public.catalog_track_baselines TO service_role;

ALTER TABLE public.catalog_track_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access_catalog_track_baselines"
  ON public.catalog_track_baselines
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 5. catalog_distribution_batches — auditoria de cada "Distribuir"
-- ---------------------------------------------------------------------
CREATE TABLE public.catalog_distribution_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_track_id uuid NOT NULL REFERENCES public.catalog_tracks(id) ON DELETE CASCADE,
  triggered_by uuid,
  total_eligible_playlists integer NOT NULL DEFAULT 0,
  skipped_already_present integer NOT NULL DEFAULT 0,
  skipped_no_capacity integer NOT NULL DEFAULT 0,
  placements_created integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_distribution_batches TO authenticated;
GRANT ALL ON public.catalog_distribution_batches TO service_role;

ALTER TABLE public.catalog_distribution_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access_catalog_distribution_batches"
  ON public.catalog_distribution_batches
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_catalog_distribution_batches_track
  ON public.catalog_distribution_batches (catalog_track_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 6. catalog_placements — música × playlist (tabela crítica)
-- ---------------------------------------------------------------------
CREATE TABLE public.catalog_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_track_id uuid NOT NULL REFERENCES public.catalog_tracks(id) ON DELETE CASCADE,
  managed_playlist_id uuid NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  position integer,
  added_at timestamptz,
  removed_at timestamptz,
  removed_reason text,
  distribution_batch_id uuid REFERENCES public.catalog_distribution_batches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_placements_status_check CHECK (status IN ('pending','active','removed','failed'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_placements TO authenticated;
GRANT ALL ON public.catalog_placements TO service_role;

ALTER TABLE public.catalog_placements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access_catalog_placements"
  ON public.catalog_placements
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- UNIQUE crítico: impossível placement vivo duplicado. Pode reentrar após remoção.
CREATE UNIQUE INDEX idx_catalog_placements_unique_alive
  ON public.catalog_placements (catalog_track_id, managed_playlist_id)
  WHERE status <> 'removed';

CREATE INDEX idx_catalog_placements_playlist_active
  ON public.catalog_placements (managed_playlist_id)
  WHERE status = 'active';

CREATE INDEX idx_catalog_placements_track
  ON public.catalog_placements (catalog_track_id);

CREATE INDEX idx_catalog_placements_batch
  ON public.catalog_placements (distribution_batch_id)
  WHERE distribution_batch_id IS NOT NULL;

CREATE TRIGGER trg_catalog_placements_updated_at
  BEFORE UPDATE ON public.catalog_placements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 7. View v_catalog_playlist_occupancy
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_catalog_playlist_occupancy AS
SELECT
  mp.id                AS managed_playlist_id,
  mp.name              AS playlist_name,
  mp.catalog_capacity,
  COALESCE(p.active_placements, 0)                              AS active_placements,
  GREATEST(mp.catalog_capacity - COALESCE(p.active_placements, 0), 0) AS available_slots
FROM public.managed_playlists mp
LEFT JOIN (
  SELECT managed_playlist_id, COUNT(*)::int AS active_placements
  FROM public.catalog_placements
  WHERE status = 'active'
  GROUP BY managed_playlist_id
) p ON p.managed_playlist_id = mp.id
WHERE mp.is_catalog = true;

GRANT SELECT ON public.v_catalog_playlist_occupancy TO authenticated;
GRANT SELECT ON public.v_catalog_playlist_occupancy TO service_role;