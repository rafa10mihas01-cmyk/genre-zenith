
ALTER TABLE public.curators
  ADD COLUMN IF NOT EXISTS performance_score numeric(5,2),
  ADD COLUMN IF NOT EXISTS performance_score_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.recalc_curator_performance_scores()
RETURNS TABLE (curator_id uuid, score numeric, deals_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - interval '90 days';
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      cd.curator_id,
      COUNT(*)::int AS deals_count,
      SUM(GREATEST(cd.target_plays, 1)) AS sum_target,
      SUM(LEAST(cd.reconciled_total_plays, cd.target_plays * 2)) AS sum_delivered,
      COUNT(*) FILTER (WHERE cd.closed_at IS NOT NULL) AS closed_count,
      COUNT(*) FILTER (WHERE cd.closed_status = 'completed') AS completed_count,
      COUNT(*) FILTER (
        WHERE cd.closed_at IS NULL
          AND cd.ends_at IS NOT NULL
          AND cd.ends_at < now()
      ) AS overdue_count
    FROM public.curator_deals cd
    WHERE cd.curator_id IS NOT NULL
      AND cd.started_at >= v_cutoff
    GROUP BY cd.curator_id
  ),
  scored AS (
    SELECT
      b.curator_id,
      b.deals_count,
      LEAST(1.0, GREATEST(0.0, COALESCE(b.sum_delivered::numeric / NULLIF(b.sum_target, 0), 0))) AS delivery_rate,
      CASE WHEN b.closed_count > 0
        THEN b.completed_count::numeric / b.closed_count
        ELSE 0
      END AS completion_rate,
      LEAST(1.0, b.overdue_count::numeric / NULLIF(b.deals_count, 0)) AS delay_penalty
    FROM base b
  ),
  final AS (
    SELECT
      s.curator_id,
      s.deals_count,
      GREATEST(0, LEAST(100,
        (50 * s.delivery_rate) + (30 * s.completion_rate) - (20 * s.delay_penalty)
      ))::numeric(5,2) AS score
    FROM scored s
  ),
  upd AS (
    UPDATE public.curators c
       SET performance_score = f.score,
           performance_score_updated_at = now()
      FROM final f
     WHERE c.id = f.curator_id
     RETURNING c.id, f.score, f.deals_count
  )
  SELECT upd.id, upd.score, upd.deals_count FROM upd;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_curator_performance_scores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_curator_performance_scores() TO service_role, authenticated;
