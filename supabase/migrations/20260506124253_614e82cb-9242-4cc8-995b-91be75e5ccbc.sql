DROP VIEW IF EXISTS public.v_storage_growth;

CREATE VIEW public.v_storage_growth
WITH (security_invoker = true)
AS
WITH snap AS (
  SELECT
    count(*)::bigint AS rows,
    COALESCE(SUM(pg_column_size(ai_raw)), 0)::bigint AS ai_raw_bytes
  FROM public.curator_deal_snapshots
),
batches AS (
  SELECT
    count(*)::bigint AS rows,
    COALESCE(SUM(pg_column_size(dom_payload)), 0)::bigint AS dom_payload_bytes,
    COALESCE(SUM(pg_column_size(print_paths)), 0)::bigint AS print_paths_bytes
  FROM public.bot_print_batches
),
metrics AS (
  SELECT count(*)::bigint AS rows FROM public.ops_metrics
),
events AS (
  SELECT count(*)::bigint AS rows FROM public.bot_events
)
SELECT
  (SELECT rows FROM snap)              AS curator_snapshots_rows,
  (SELECT ai_raw_bytes FROM snap)      AS curator_snapshots_ai_raw_bytes,
  (SELECT rows FROM batches)           AS bot_print_batches_rows,
  (SELECT dom_payload_bytes FROM batches) AS bot_print_batches_dom_payload_bytes,
  (SELECT print_paths_bytes FROM batches) AS bot_print_batches_print_paths_bytes,
  (SELECT rows FROM metrics)           AS ops_metrics_rows,
  (SELECT rows FROM events)            AS bot_events_rows,
  now()                                AS computed_at;

GRANT SELECT ON public.v_storage_growth TO authenticated;