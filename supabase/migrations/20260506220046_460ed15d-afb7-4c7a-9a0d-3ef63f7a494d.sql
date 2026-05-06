
ALTER TABLE public.bot_events
  ADD COLUMN IF NOT EXISTS correlation_id uuid,
  ADD COLUMN IF NOT EXISTS lifecycle_state text,
  ADD COLUMN IF NOT EXISTS discard_reason text;

ALTER TABLE public.bot_events
  DROP CONSTRAINT IF EXISTS bot_events_lifecycle_state_check;
ALTER TABLE public.bot_events
  ADD CONSTRAINT bot_events_lifecycle_state_check
  CHECK (lifecycle_state IS NULL OR lifecycle_state IN (
    'FETCHED','ACCEPTED','QUEUED_LOCAL','STARTED',
    'PRINT_UPLOADED','SNAPSHOT_SENT','FINISHED','FAILED','DISCARDED'
  ));

CREATE INDEX IF NOT EXISTS idx_bot_events_correlation_id
  ON public.bot_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_bot_events_lifecycle_state
  ON public.bot_events(lifecycle_state);

ALTER TABLE public.bot_print_batches
  ADD COLUMN IF NOT EXISTS correlation_id uuid;
CREATE INDEX IF NOT EXISTS idx_bot_print_batches_correlation_id
  ON public.bot_print_batches(correlation_id);

ALTER TABLE public.curator_deal_snapshots
  ADD COLUMN IF NOT EXISTS correlation_id uuid;
CREATE INDEX IF NOT EXISTS idx_curator_deal_snapshots_correlation_id
  ON public.curator_deal_snapshots(correlation_id);

DROP VIEW IF EXISTS public.v_dispatch_trace;
CREATE VIEW public.v_dispatch_trace AS
WITH evs AS (
  SELECT
    correlation_id,
    (array_agg(deal_id) FILTER (WHERE deal_id IS NOT NULL))[1] AS deal_id,
    (array_agg(song_id) FILTER (WHERE song_id IS NOT NULL))[1] AS song_id,
    MIN(created_at) FILTER (WHERE lifecycle_state='FETCHED')         AS fetched_at,
    MIN(created_at) FILTER (WHERE lifecycle_state='ACCEPTED')        AS accepted_at,
    MIN(created_at) FILTER (WHERE lifecycle_state='QUEUED_LOCAL')    AS queued_local_at,
    MIN(created_at) FILTER (WHERE lifecycle_state='STARTED')         AS started_at,
    MIN(created_at) FILTER (WHERE lifecycle_state='PRINT_UPLOADED')  AS print_uploaded_at,
    MIN(created_at) FILTER (WHERE lifecycle_state='SNAPSHOT_SENT')   AS snapshot_sent_at,
    MIN(created_at) FILTER (WHERE lifecycle_state='FINISHED')        AS finished_at,
    MIN(created_at) FILTER (WHERE lifecycle_state='FAILED')          AS failed_at,
    MIN(created_at) FILTER (WHERE lifecycle_state='DISCARDED')       AS discarded_at,
    (array_agg(discard_reason) FILTER (WHERE discard_reason IS NOT NULL))[1] AS discard_reason
  FROM public.bot_events
  WHERE correlation_id IS NOT NULL
  GROUP BY correlation_id
),
batches AS (
  SELECT correlation_id,
         (array_agg(id ORDER BY created_at DESC))[1] AS batch_id,
         (array_agg(status ORDER BY created_at DESC))[1] AS batch_status,
         MAX(received_parts) AS received_parts,
         MAX(total_parts) AS total_parts
  FROM public.bot_print_batches
  WHERE correlation_id IS NOT NULL
  GROUP BY correlation_id
),
snaps AS (
  SELECT correlation_id,
         COUNT(*)::int AS snapshot_count,
         COALESCE(SUM(plays),0)::bigint AS total_plays_extracted
  FROM public.curator_deal_snapshots
  WHERE correlation_id IS NOT NULL
  GROUP BY correlation_id
)
SELECT
  evs.correlation_id,
  evs.deal_id, evs.song_id,
  evs.fetched_at, evs.accepted_at, evs.queued_local_at, evs.started_at,
  evs.print_uploaded_at, evs.snapshot_sent_at, evs.finished_at,
  evs.failed_at, evs.discarded_at, evs.discard_reason,
  b.batch_id, b.batch_status, b.received_parts, b.total_parts,
  COALESCE(s.snapshot_count, 0) AS snapshot_count,
  COALESCE(s.total_plays_extracted, 0) AS total_plays_extracted
FROM evs
LEFT JOIN batches b ON b.correlation_id = evs.correlation_id
LEFT JOIN snaps   s ON s.correlation_id = evs.correlation_id;

GRANT SELECT ON public.v_dispatch_trace TO authenticated;
