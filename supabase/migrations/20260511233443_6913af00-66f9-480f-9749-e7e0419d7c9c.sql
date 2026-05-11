-- Fase 2: Playlist Intelligence + Health Engine

CREATE TABLE IF NOT EXISTS public.playlist_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL UNIQUE REFERENCES public.playlists(id) ON DELETE CASCADE,
  health_score smallint NOT NULL DEFAULT 0,
  delivery_score smallint NOT NULL DEFAULT 0,
  capacity_score smallint NOT NULL DEFAULT 0,
  risk_score smallint NOT NULL DEFAULT 0,
  activity_score smallint NOT NULL DEFAULT 0,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playlist_scores_health ON public.playlist_scores(health_score DESC);
CREATE INDEX IF NOT EXISTS idx_playlist_scores_calculated ON public.playlist_scores(calculated_at);

ALTER TABLE public.playlist_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_select_playlist_scores ON public.playlist_scores;
DROP POLICY IF EXISTS team_insert_playlist_scores ON public.playlist_scores;
DROP POLICY IF EXISTS team_update_playlist_scores ON public.playlist_scores;
DROP POLICY IF EXISTS team_delete_playlist_scores ON public.playlist_scores;
CREATE POLICY team_select_playlist_scores ON public.playlist_scores FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_playlist_scores ON public.playlist_scores FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_playlist_scores ON public.playlist_scores FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_playlist_scores ON public.playlist_scores FOR DELETE TO authenticated USING (has_team_access());

-- Recalc function
CREATE OR REPLACE FUNCTION public.recalc_playlist_scores()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_cap_ceiling bigint := 50000;
  v_del_ceiling bigint := 500000;
BEGIN
  WITH
  agg_snapshots AS (
    SELECT cp.canonical_playlist_id AS playlist_id,
           MAX(s.captured_at) AS last_snapshot_at,
           SUM(s.plays_28d)   AS plays_28d,
           SUM(s.plays_7d)    AS plays_7d,
           SUM(s.plays_24h)   AS plays_24h
    FROM public.curator_deal_snapshots s
    JOIN public.curator_playlists cp ON cp.id = s.playlist_id
    WHERE cp.canonical_playlist_id IS NOT NULL
    GROUP BY cp.canonical_playlist_id
  ),
  agg_deals AS (
    SELECT canonical_playlist_id AS playlist_id,
           SUM(streams_total) AS streams_total,
           SUM(streams_28d)   AS streams_28d,
           SUM(streams_7d)    AS streams_7d,
           MAX(added_at)      AS last_added_at
    FROM public.curator_playlists
    WHERE canonical_playlist_id IS NOT NULL
    GROUP BY canonical_playlist_id
  ),
  agg_library AS (
    SELECT canonical_playlist_id AS playlist_id,
           MAX(times_used)   AS times_used,
           MAX(last_used_at) AS last_used_at
    FROM public.curator_playlist_library
    WHERE canonical_playlist_id IS NOT NULL
    GROUP BY canonical_playlist_id
  ),
  agg_managed AS (
    SELECT canonical_playlist_id AS playlist_id,
           MAX(GREATEST(COALESCE(last_metrics_at, '-infinity'::timestamptz),
                        COALESCE(updated_at, '-infinity'::timestamptz))) AS last_managed_activity
    FROM public.managed_playlists
    WHERE canonical_playlist_id IS NOT NULL AND archived_at IS NULL
    GROUP BY canonical_playlist_id
  ),
  combined AS (
    SELECT p.id AS playlist_id,
           COALESCE(s.plays_28d, 0)       AS plays_28d,
           COALESCE(s.plays_7d, 0)        AS plays_7d,
           COALESCE(s.plays_24h, 0)       AS plays_24h,
           s.last_snapshot_at,
           COALESCE(d.streams_total, 0)   AS streams_total,
           COALESCE(d.streams_28d, 0)     AS streams_28d,
           COALESCE(d.streams_7d, 0)      AS streams_7d,
           GREATEST(
             COALESCE(l.last_used_at, '-infinity'::timestamptz),
             COALESCE(m.last_managed_activity, '-infinity'::timestamptz),
             COALESCE(d.last_added_at, '-infinity'::timestamptz),
             COALESCE(s.last_snapshot_at, '-infinity'::timestamptz)
           ) AS last_activity_at,
           COALESCE(l.times_used, 0) AS times_used
    FROM public.playlists p
    LEFT JOIN agg_snapshots s ON s.playlist_id = p.id
    LEFT JOIN agg_deals     d ON d.playlist_id = p.id
    LEFT JOIN agg_library   l ON l.playlist_id = p.id
    LEFT JOIN agg_managed   m ON m.playlist_id = p.id
  ),
  scored AS (
    SELECT
      playlist_id,
      -- capacity: log scale capped at v_cap_ceiling
      LEAST(100, GREATEST(0, ROUND(100.0 * ln(1 + GREATEST(plays_28d, streams_28d)) / ln(1 + v_cap_ceiling))))::smallint AS capacity_score,
      -- delivery: log scale on lifetime streams
      LEAST(100, GREATEST(0, ROUND(100.0 * ln(1 + streams_total) / ln(1 + v_del_ceiling))))::smallint AS delivery_score,
      -- activity: 100 if active in last 7d, linear decay to 0 by 90d
      CASE
        WHEN last_activity_at = '-infinity'::timestamptz THEN 0
        WHEN last_activity_at > now() - interval '7 days'  THEN 100
        WHEN last_activity_at < now() - interval '90 days' THEN 0
        ELSE GREATEST(0, LEAST(100, ROUND(100.0 * (1 - EXTRACT(EPOCH FROM (now() - last_activity_at)) / EXTRACT(EPOCH FROM interval '90 days')))))::smallint
      END::smallint AS activity_score,
      -- risk: deviation of weekly run-rate vs monthly run-rate
      CASE
        WHEN plays_28d <= 0 THEN 0
        ELSE LEAST(100, GREATEST(0, ROUND(100.0 * ABS(4.0 * plays_7d - plays_28d) / NULLIF(plays_28d, 0))))::smallint
      END::smallint AS risk_score,
      plays_28d, plays_7d, plays_24h, streams_total, streams_28d, streams_7d,
      times_used, last_activity_at, last_snapshot_at
    FROM combined
  ),
  final AS (
    SELECT
      playlist_id,
      capacity_score, delivery_score, activity_score, risk_score,
      LEAST(100, GREATEST(0, ROUND(
        0.30 * capacity_score
      + 0.25 * delivery_score
      + 0.20 * activity_score
      + 0.25 * (100 - risk_score)
      )))::smallint AS health_score,
      jsonb_build_object(
        'plays_28d', plays_28d,
        'plays_7d', plays_7d,
        'plays_24h', plays_24h,
        'streams_total', streams_total,
        'streams_28d', streams_28d,
        'streams_7d', streams_7d,
        'times_used', times_used,
        'last_activity_at', last_activity_at,
        'last_snapshot_at', last_snapshot_at,
        'caps', jsonb_build_object('capacity', v_cap_ceiling, 'delivery', v_del_ceiling)
      ) AS metadata
    FROM scored
  )
  INSERT INTO public.playlist_scores (playlist_id, health_score, delivery_score, capacity_score, risk_score, activity_score, calculated_at, metadata)
  SELECT playlist_id, health_score, delivery_score, capacity_score, risk_score, activity_score, now(), metadata
  FROM final
  ON CONFLICT (playlist_id) DO UPDATE
    SET health_score   = EXCLUDED.health_score,
        delivery_score = EXCLUDED.delivery_score,
        capacity_score = EXCLUDED.capacity_score,
        risk_score     = EXCLUDED.risk_score,
        activity_score = EXCLUDED.activity_score,
        calculated_at  = EXCLUDED.calculated_at,
        metadata       = EXCLUDED.metadata;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Manual trigger (team-gated)
CREATE OR REPLACE FUNCTION public.trigger_recalc_playlist_scores()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT has_team_access() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  v_count := public.recalc_playlist_scores();
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_playlist_scores() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trigger_recalc_playlist_scores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trigger_recalc_playlist_scores() TO authenticated;

-- Initial run
SELECT public.recalc_playlist_scores();