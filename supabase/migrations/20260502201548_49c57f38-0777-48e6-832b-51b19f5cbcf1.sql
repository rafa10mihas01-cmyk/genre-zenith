-- 1) Limpa dados da engine antiga
DELETE FROM public.curator_deal_logs;

UPDATE public.curator_deals
   SET reconciled_streams_7d = 0,
       reconciled_streams_28d = 0,
       reconciled_total_plays = 0,
       last_reconciled_at = NULL;

UPDATE public.curator_playlists
   SET streams_7d = 0,
       streams_28d = 0,
       streams_total = 0,
       last_paste_at = NULL;

-- 2) Nova tabela de snapshots (fonte única de verdade)
CREATE TABLE public.curator_deal_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  song_id uuid,
  playlist_id uuid NOT NULL,
  plays bigint NOT NULL DEFAULT 0,
  captured_at timestamptz NOT NULL DEFAULT now(),
  print_url text,
  is_baseline boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'spotify_for_artists',
  created_by uuid,
  ai_confidence numeric,
  ai_raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cds_deal ON public.curator_deal_snapshots(deal_id, captured_at DESC);
CREATE INDEX idx_cds_playlist ON public.curator_deal_snapshots(playlist_id, captured_at DESC);
CREATE INDEX idx_cds_song ON public.curator_deal_snapshots(song_id, captured_at DESC);

ALTER TABLE public.curator_deal_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own deal_snapshots"
  ON public.curator_deal_snapshots FOR SELECT TO authenticated
  USING (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

CREATE POLICY "Users insert own deal_snapshots"
  ON public.curator_deal_snapshots FOR INSERT TO authenticated
  WITH CHECK (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

CREATE POLICY "Users update own deal_snapshots"
  ON public.curator_deal_snapshots FOR UPDATE TO authenticated
  USING (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()))
  WITH CHECK (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

CREATE POLICY "Users delete own deal_snapshots"
  ON public.curator_deal_snapshots FOR DELETE TO authenticated
  USING (deal_id IN (SELECT id FROM public.curator_deals WHERE user_id = auth.uid()));

-- 3) Função de progresso a partir de snapshots
CREATE OR REPLACE FUNCTION public.get_curator_deal_progress(p_deal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH ordered AS (
    SELECT
      s.playlist_id,
      s.plays,
      s.captured_at,
      s.is_baseline,
      LAG(s.plays) OVER (PARTITION BY s.playlist_id ORDER BY s.captured_at) AS prev_plays,
      LAG(s.captured_at) OVER (PARTITION BY s.playlist_id ORDER BY s.captured_at) AS prev_at
    FROM public.curator_deal_snapshots s
    WHERE s.deal_id = p_deal_id
  ),
  deltas AS (
    SELECT
      o.playlist_id,
      GREATEST(o.plays - COALESCE(o.prev_plays, 0), 0) AS delivered,
      o.captured_at,
      o.is_baseline,
      o.prev_plays IS NULL AS is_first
    FROM ordered o
  ),
  per_playlist AS (
    SELECT
      d.playlist_id,
      cp.playlist_name,
      cp.is_baseline AS playlist_is_baseline,
      SUM(CASE WHEN d.is_first THEN 0 ELSE d.delivered END) AS delivered,
      MAX(d.captured_at) AS last_captured_at,
      COUNT(*) FILTER (WHERE NOT d.is_first) AS snapshot_count
    FROM deltas d
    LEFT JOIN public.curator_playlists cp ON cp.id = d.playlist_id
    GROUP BY d.playlist_id, cp.playlist_name, cp.is_baseline
  ),
  totals AS (
    SELECT
      COALESCE(SUM(delivered) FILTER (WHERE NOT playlist_is_baseline), 0) AS delivered_curator,
      COALESCE(SUM(delivered), 0) AS delivered_total,
      MIN(last_captured_at) AS first_at,
      MAX(last_captured_at) AS last_at
    FROM per_playlist
  ),
  range_info AS (
    SELECT
      MIN(captured_at) AS first_capture,
      MAX(captured_at) AS last_capture
    FROM public.curator_deal_snapshots
    WHERE deal_id = p_deal_id
  )
  SELECT jsonb_build_object(
    'deal_id', p_deal_id,
    'delivered_curator', t.delivered_curator,
    'delivered_total', t.delivered_total,
    'first_capture_at', r.first_capture,
    'last_capture_at', r.last_capture,
    'days_elapsed', CASE
      WHEN r.first_capture IS NULL OR r.last_capture IS NULL THEN 0
      ELSE GREATEST(EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) / 86400.0, 0)
    END,
    'daily_avg', CASE
      WHEN r.first_capture IS NULL OR r.last_capture IS NULL
        OR EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) <= 0 THEN 0
      ELSE t.delivered_curator / (EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) / 86400.0)
    END,
    'per_playlist', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'playlist_id', pp.playlist_id,
        'playlist_name', pp.playlist_name,
        'is_baseline', pp.playlist_is_baseline,
        'delivered', pp.delivered,
        'last_captured_at', pp.last_captured_at,
        'snapshot_count', pp.snapshot_count
      ) ORDER BY pp.delivered DESC) FROM per_playlist pp),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM totals t CROSS JOIN range_info r;

  RETURN COALESCE(v_result, jsonb_build_object(
    'deal_id', p_deal_id,
    'delivered_curator', 0,
    'delivered_total', 0,
    'daily_avg', 0,
    'days_elapsed', 0,
    'per_playlist', '[]'::jsonb
  ));
END;
$$;