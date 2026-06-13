
-- ============================================================
-- CAMADA B — Orgânico Externo (isolada do operacional)
-- ============================================================

-- 1) Blocklist de placeholders algorítmicos
CREATE TABLE public.observed_playlists_blocklist (
  id text PRIMARY KEY,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.observed_playlists_blocklist TO authenticated;
GRANT ALL ON public.observed_playlists_blocklist TO service_role;
ALTER TABLE public.observed_playlists_blocklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blocklist read all auth"
  ON public.observed_playlists_blocklist FOR SELECT TO authenticated USING (true);

INSERT INTO public.observed_playlists_blocklist(id, reason) VALUES
  ('discover_weekly','placeholder algorítmico Spotify'),
  ('smart_shuffle','placeholder algorítmico Spotify'),
  ('blend','placeholder algorítmico Spotify'),
  ('daylist','placeholder algorítmico Spotify'),
  ('your_dj','placeholder algorítmico Spotify'),
  ('radio','placeholder algorítmico Spotify'),
  ('mix','placeholder algorítmico Spotify'),
  ('on_repeat','placeholder algorítmico Spotify');

-- 2) Catálogo de playlists observadas
CREATE TABLE public.observed_playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_playlist_id text NOT NULL UNIQUE,
  playlist_name text,
  spotify_owner_id text,
  spotify_owner_name text,
  owner_type text CHECK (owner_type IN ('spotify','label','user','unknown')) DEFAULT 'unknown',
  followers bigint,
  image_url text,
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  observation_count integer NOT NULL DEFAULT 0,
  total_plays_observed bigint NOT NULL DEFAULT 0,
  enrichment_status text NOT NULL DEFAULT 'pending'
    CHECK (enrichment_status IN ('pending','enriched','failed','dead')),
  enriched_at timestamptz,
  promoted_to_curator_playlist_id uuid REFERENCES public.curator_playlists(id) ON DELETE SET NULL,
  promoted_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_observed_playlists_owner ON public.observed_playlists(spotify_owner_id);
CREATE INDEX idx_observed_playlists_last_obs ON public.observed_playlists(last_observed_at DESC);
CREATE INDEX idx_observed_playlists_total_plays ON public.observed_playlists(total_plays_observed DESC);
CREATE INDEX idx_observed_playlists_enrichment ON public.observed_playlists(enrichment_status)
  WHERE enrichment_status = 'pending';

GRANT SELECT ON public.observed_playlists TO authenticated;
GRANT ALL ON public.observed_playlists TO service_role;
ALTER TABLE public.observed_playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "observed_playlists read auth"
  ON public.observed_playlists FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_observed_playlists_updated_at
  BEFORE UPDATE ON public.observed_playlists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Snapshots observados
CREATE TABLE public.observed_playlist_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observed_playlist_id uuid NOT NULL REFERENCES public.observed_playlists(id) ON DELETE CASCADE,
  song_id uuid REFERENCES public.curator_deal_songs(id) ON DELETE SET NULL,
  deal_id uuid, -- contexto apenas (NÃO usado em ROI). Sem FK pra evitar acoplamento.
  spotify_track_id text,
  plays_24h integer,
  plays_7d integer,
  plays_28d integer,
  source text,
  correlation_id text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ops_obs_pl ON public.observed_playlist_snapshots(observed_playlist_id, captured_at DESC);
CREATE INDEX idx_ops_song ON public.observed_playlist_snapshots(song_id);
CREATE INDEX idx_ops_captured ON public.observed_playlist_snapshots(captured_at DESC);

GRANT SELECT ON public.observed_playlist_snapshots TO authenticated;
GRANT ALL ON public.observed_playlist_snapshots TO service_role;
ALTER TABLE public.observed_playlist_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "observed_snapshots read auth"
  ON public.observed_playlist_snapshots FOR SELECT TO authenticated USING (true);

-- NOTA: NENHUM trigger atualiza campaigns.total_delivered. Isolamento arquitetural garantido.

-- 4) Trigger pra manter cache em observed_playlists ao inserir snapshot
CREATE OR REPLACE FUNCTION public.update_observed_playlist_cache()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.observed_playlists
  SET
    last_observed_at = GREATEST(last_observed_at, NEW.captured_at),
    observation_count = observation_count + 1,
    total_plays_observed = total_plays_observed + COALESCE(NEW.plays_7d, 0)
  WHERE id = NEW.observed_playlist_id;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_ops_update_cache
  AFTER INSERT ON public.observed_playlist_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_observed_playlist_cache();

-- ============================================================
-- BACKFILL: 98 playlists + 6.450 snapshots órfãos (últimos 90d)
-- ============================================================

-- 5) Backfill do catálogo (98 playlists únicas)
WITH orphans AS (
  SELECT DISTINCT spotify_playlist_id, playlist_name
  FROM public.organic_plays_snapshots
  WHERE spotify_playlist_id IS NOT NULL
    AND captured_at >= now() - interval '90 days'
    AND spotify_playlist_id NOT IN (SELECT id FROM public.observed_playlists_blocklist)
    AND spotify_playlist_id NOT IN (
      SELECT spotify_playlist_id FROM public.curator_playlists WHERE spotify_playlist_id IS NOT NULL
    )
    AND spotify_playlist_id NOT IN (
      SELECT spotify_playlist_id FROM public.managed_playlists WHERE spotify_playlist_id IS NOT NULL
    )
)
INSERT INTO public.observed_playlists (spotify_playlist_id, playlist_name, enrichment_status)
SELECT
  spotify_playlist_id,
  (ARRAY_AGG(playlist_name) FILTER (WHERE playlist_name IS NOT NULL))[1],
  'pending'
FROM orphans
GROUP BY spotify_playlist_id
ON CONFLICT (spotify_playlist_id) DO NOTHING;

-- 6) Backfill dos snapshots (6.450 linhas)
INSERT INTO public.observed_playlist_snapshots
  (observed_playlist_id, song_id, deal_id, spotify_track_id, plays_24h, plays_7d, plays_28d, source, correlation_id, captured_at)
SELECT
  op.id,
  ops.song_id,
  ops.deal_id,
  ops.spotify_track_id,
  ops.plays_24h,
  ops.plays_7d,
  ops.plays_28d,
  COALESCE(ops.source, 'backfill_2026_06_13'),
  ops.correlation_id,
  ops.captured_at
FROM public.organic_plays_snapshots ops
JOIN public.observed_playlists op
  ON op.spotify_playlist_id = ops.spotify_playlist_id
WHERE ops.captured_at >= now() - interval '90 days'
  AND ops.spotify_playlist_id NOT IN (SELECT id FROM public.observed_playlists_blocklist);

-- 7) Recalcula cache a partir do backfill (trigger não roda em massa eficiente)
UPDATE public.observed_playlists op
SET
  observation_count = sub.cnt,
  total_plays_observed = sub.tot,
  first_observed_at = sub.first_at,
  last_observed_at = sub.last_at
FROM (
  SELECT observed_playlist_id,
         COUNT(*) AS cnt,
         COALESCE(SUM(plays_7d), 0) AS tot,
         MIN(captured_at) AS first_at,
         MAX(captured_at) AS last_at
  FROM public.observed_playlist_snapshots
  GROUP BY observed_playlist_id
) sub
WHERE op.id = sub.observed_playlist_id;

-- NOTE: ingest (extract-snapshot-from-print + bot-collect-queue) será patchado em PR separado
-- pra rotear novas observações pra observed_* em vez de organic_plays_snapshots.
