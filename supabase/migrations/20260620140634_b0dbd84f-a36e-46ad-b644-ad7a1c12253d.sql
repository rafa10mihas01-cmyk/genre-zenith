
ALTER TABLE public.spotify_playlist_cache
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS owner_id text,
  ADD COLUMN IF NOT EXISTS total_tracks integer,
  ADD COLUMN IF NOT EXISTS snapshot_id text,
  ADD COLUMN IF NOT EXISTS public_flag boolean,
  ADD COLUMN IF NOT EXISTS collaborative boolean,
  ADD COLUMN IF NOT EXISTS tracks_jsonb jsonb,
  ADD COLUMN IF NOT EXISTS meta_refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS tracks_refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS fetch_status text DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS etag text,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'legacy';

CREATE UNIQUE INDEX IF NOT EXISTS spotify_playlist_cache_pid_uidx
  ON public.spotify_playlist_cache(spotify_playlist_id);
CREATE INDEX IF NOT EXISTS spotify_playlist_cache_meta_refreshed_idx
  ON public.spotify_playlist_cache(meta_refreshed_at);
CREATE INDEX IF NOT EXISTS spotify_playlist_cache_tracks_refreshed_idx
  ON public.spotify_playlist_cache(tracks_refreshed_at);
CREATE INDEX IF NOT EXISTS spotify_playlist_cache_fetch_status_idx
  ON public.spotify_playlist_cache(fetch_status);

CREATE TABLE IF NOT EXISTS public.catalog_inflight (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_key text NOT NULL UNIQUE,
  endpoint text NOT NULL,
  resource_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '60 seconds'),
  caller text,
  status text NOT NULL DEFAULT 'running'
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_inflight TO authenticated;
GRANT ALL ON public.catalog_inflight TO service_role;

ALTER TABLE public.catalog_inflight ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role manages catalog_inflight"
  ON public.catalog_inflight FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS catalog_inflight_expires_idx
  ON public.catalog_inflight(expires_at);

CREATE OR REPLACE VIEW public.catalog_gateway_metrics AS
SELECT
  date_trunc('hour', created_at) AS hour,
  COALESCE(meta->>'source', 'direct') AS source,
  endpoint,
  function_name AS caller,
  count(*) AS calls,
  count(*) FILTER (WHERE http_status = 200) AS ok_calls,
  count(*) FILTER (WHERE http_status = 403) AS forbidden_calls,
  count(*) FILTER (WHERE http_status = 429) AS ratelimited_calls,
  count(*) FILTER (WHERE http_status >= 500) AS server_error_calls,
  avg(duration_ms)::int AS avg_duration_ms
FROM public.spotify_call_log
WHERE created_at > now() - interval '7 days'
GROUP BY 1, 2, 3, 4;

GRANT SELECT ON public.catalog_gateway_metrics TO authenticated, service_role;
