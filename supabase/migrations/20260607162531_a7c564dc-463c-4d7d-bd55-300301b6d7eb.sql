DROP VIEW IF EXISTS public.v_snapshot_prints;

CREATE VIEW public.v_snapshot_prints
WITH (security_invoker = true)
AS
WITH ranked_batches AS (
  SELECT
    b.*,
    row_number() OVER (
      PARTITION BY
        b.deal_id,
        b.song_id,
        COALESCE(b.correlation_id::text, b.id::text)
      ORDER BY
        CASE b.status WHEN 'processed' THEN 0 WHEN 'complete' THEN 1 ELSE 2 END,
        b.created_at DESC,
        b.id DESC
    ) AS rn
  FROM public.bot_print_batches b
  WHERE b.superseded_by IS NULL
    AND b.status IN ('complete', 'processed')
    AND jsonb_typeof(b.print_urls) = 'array'
    AND jsonb_array_length(b.print_urls) > 0
)
SELECT
  b.id AS run_id,
  b.deal_id,
  b.song_id,
  cd.campaign_id,
  b.created_at,
  b.completed_at,
  ARRAY(SELECT jsonb_array_elements_text(b.print_urls)) AS print_urls,
  jsonb_array_length(b.print_urls) AS print_count
FROM ranked_batches b
LEFT JOIN public.curator_deals cd ON cd.id = b.deal_id
WHERE b.rn = 1;

GRANT SELECT ON public.v_snapshot_prints TO authenticated, anon, service_role;