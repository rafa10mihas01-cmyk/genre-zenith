
-- ============================================================================
-- Spotify enrichment cache (track + artist) + async queue
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.spotify_track_cache (
  spotify_track_id text PRIMARY KEY,
  name text,
  isrc text,
  album_id text,
  release_date date,
  duration_ms integer,
  explicit boolean,
  popularity smallint,
  artist_ids text[] NOT NULL DEFAULT '{}',
  raw jsonb,
  source_app_id uuid,
  enriched_at timestamptz,
  popularity_refreshed_at timestamptz,
  fetch_status text NOT NULL DEFAULT 'ok',
  fetch_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stc_pop_refreshed ON public.spotify_track_cache (popularity_refreshed_at);
CREATE INDEX IF NOT EXISTS idx_stc_artist_ids ON public.spotify_track_cache USING GIN (artist_ids);
CREATE INDEX IF NOT EXISTS idx_stc_fetch_status ON public.spotify_track_cache (fetch_status);

GRANT SELECT ON public.spotify_track_cache TO authenticated;
GRANT ALL ON public.spotify_track_cache TO service_role;
ALTER TABLE public.spotify_track_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_read_stc" ON public.spotify_track_cache FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.spotify_artist_cache (
  spotify_artist_id text PRIMARY KEY,
  name text,
  genres text[] NOT NULL DEFAULT '{}',
  popularity smallint,
  followers integer,
  image_url text,
  raw jsonb,
  source_app_id uuid,
  enriched_at timestamptz,
  refreshed_at timestamptz,
  genres_refreshed_at timestamptz,
  fetch_status text NOT NULL DEFAULT 'ok',
  fetch_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sac_refreshed ON public.spotify_artist_cache (refreshed_at);
CREATE INDEX IF NOT EXISTS idx_sac_genres_refreshed ON public.spotify_artist_cache (genres_refreshed_at);
CREATE INDEX IF NOT EXISTS idx_sac_fetch_status ON public.spotify_artist_cache (fetch_status);

GRANT SELECT ON public.spotify_artist_cache TO authenticated;
GRANT ALL ON public.spotify_artist_cache TO service_role;
ALTER TABLE public.spotify_artist_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_read_sac" ON public.spotify_artist_cache FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.spotify_enrichment_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('track','artist')),
  ref_id text NOT NULL,
  reason text NOT NULL DEFAULT 'new',
  priority smallint NOT NULL DEFAULT 5,
  attempts smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','done','failed','skipped_forbidden')),
  last_error text,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  claimed_by text,
  claimed_at timestamptz,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_seq_pending
  ON public.spotify_enrichment_queue (kind, ref_id)
  WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS idx_seq_claim
  ON public.spotify_enrichment_queue (status, scheduled_for, priority);

GRANT SELECT ON public.spotify_enrichment_queue TO authenticated;
GRANT ALL ON public.spotify_enrichment_queue TO service_role;
ALTER TABLE public.spotify_enrichment_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_read_seq" ON public.spotify_enrichment_queue FOR SELECT TO authenticated USING (true);

-- Claim N jobs atomically (FOR UPDATE SKIP LOCKED), marks them processing
CREATE OR REPLACE FUNCTION public.claim_spotify_enrichment_jobs(
  _worker text,
  _limit int DEFAULT 25
) RETURNS SETOF public.spotify_enrichment_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.spotify_enrichment_queue
    WHERE status = 'pending'
      AND scheduled_for <= now()
    ORDER BY priority ASC, scheduled_for ASC
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.spotify_enrichment_queue q
     SET status='processing',
         claimed_by=_worker,
         claimed_at=now(),
         attempts = q.attempts + 1
   FROM picked
  WHERE q.id = picked.id
  RETURNING q.*;
END$$;

REVOKE ALL ON FUNCTION public.claim_spotify_enrichment_jobs(text,int) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_spotify_enrichment_jobs(text,int) TO service_role;
