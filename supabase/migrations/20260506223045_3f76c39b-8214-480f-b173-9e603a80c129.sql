
ALTER TABLE public.bot_events
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS process_id text,
  ADD COLUMN IF NOT EXISTS hostname text,
  ADD COLUMN IF NOT EXISTS timer_id text;

ALTER TABLE public.bot_heartbeats
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS process_id text,
  ADD COLUMN IF NOT EXISTS hostname text,
  ADD COLUMN IF NOT EXISTS timer_id text,
  ADD COLUMN IF NOT EXISTS processing_correlation_ids uuid[];

CREATE INDEX IF NOT EXISTS idx_bot_events_worker ON public.bot_events (worker_id, created_at DESC) WHERE worker_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bot_events_hostname ON public.bot_events (hostname, created_at DESC) WHERE hostname IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bot_events_song_corr ON public.bot_events (song_id, correlation_id);
CREATE INDEX IF NOT EXISTS idx_bot_heartbeats_worker ON public.bot_heartbeats (worker_id, created_at DESC) WHERE worker_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bot_heartbeats_hostname ON public.bot_heartbeats (hostname, created_at DESC) WHERE hostname IS NOT NULL;

DROP VIEW IF EXISTS public.v_dispatch_trace;

CREATE VIEW public.v_dispatch_trace AS
WITH evs AS (
  SELECT
    correlation_id,
    (array_agg(deal_id) FILTER (WHERE deal_id IS NOT NULL))[1] AS deal_id,
    (array_agg(song_id) FILTER (WHERE song_id IS NOT NULL))[1] AS song_id,
    (array_agg(worker_id ORDER BY created_at) FILTER (WHERE worker_id IS NOT NULL))[1] AS worker_id,
    (array_agg(hostname ORDER BY created_at) FILTER (WHERE hostname IS NOT NULL))[1] AS hostname,
    (array_agg(process_id ORDER BY created_at) FILTER (WHERE process_id IS NOT NULL))[1] AS process_id,
    (array_agg(timer_id ORDER BY created_at) FILTER (WHERE timer_id IS NOT NULL))[1] AS timer_id,
    array_agg(DISTINCT worker_id) FILTER (WHERE worker_id IS NOT NULL) AS workers_seen,
    array_agg(DISTINCT hostname) FILTER (WHERE hostname IS NOT NULL) AS hosts_seen,
    min(created_at) FILTER (WHERE lifecycle_state = 'FETCHED')        AS fetched_at,
    min(created_at) FILTER (WHERE lifecycle_state = 'ACCEPTED')       AS accepted_at,
    min(created_at) FILTER (WHERE lifecycle_state = 'QUEUED_LOCAL')   AS queued_local_at,
    min(created_at) FILTER (WHERE lifecycle_state = 'STARTED')        AS started_at,
    min(created_at) FILTER (WHERE lifecycle_state = 'PRINT_UPLOADED') AS print_uploaded_at,
    min(created_at) FILTER (WHERE lifecycle_state = 'SNAPSHOT_SENT')  AS snapshot_sent_at,
    min(created_at) FILTER (WHERE lifecycle_state = 'FINISHED')       AS finished_at,
    min(created_at) FILTER (WHERE lifecycle_state = 'FAILED')         AS failed_at,
    min(created_at) FILTER (WHERE lifecycle_state = 'DISCARDED')      AS discarded_at,
    (array_agg(discard_reason) FILTER (WHERE discard_reason IS NOT NULL))[1] AS discard_reason,
    (array_agg(message ORDER BY created_at DESC) FILTER (WHERE lifecycle_state IN ('FAILED','DISCARDED')))[1] AS failure_message,
    count(*)::int AS total_events
  FROM public.bot_events
  WHERE correlation_id IS NOT NULL
  GROUP BY correlation_id
),
batches AS (
  SELECT
    correlation_id,
    (array_agg(id ORDER BY created_at DESC))[1] AS batch_id,
    (array_agg(status ORDER BY created_at DESC))[1] AS batch_status,
    max(received_parts) AS received_parts,
    max(total_parts) AS total_parts
  FROM public.bot_print_batches
  WHERE correlation_id IS NOT NULL
  GROUP BY correlation_id
),
snaps AS (
  SELECT
    correlation_id,
    count(*)::int AS snapshot_count,
    COALESCE(sum(plays), 0)::bigint AS total_plays_extracted,
    min(captured_at) AS first_snapshot_at,
    max(captured_at) AS last_snapshot_at
  FROM public.curator_deal_snapshots
  WHERE correlation_id IS NOT NULL
  GROUP BY correlation_id
),
last_hb AS (
  SELECT DISTINCT ON (worker_id)
    worker_id, created_at AS last_heartbeat_at, hostname AS last_heartbeat_host, processing_correlation_ids
  FROM public.bot_heartbeats
  WHERE worker_id IS NOT NULL
  ORDER BY worker_id, created_at DESC
)
SELECT
  e.correlation_id,
  e.deal_id,
  e.song_id,
  e.worker_id,
  e.hostname,
  e.process_id,
  e.timer_id,
  CASE
    WHEN e.workers_seen IS NULL OR array_length(e.workers_seen,1) <= 1 THEN false
    ELSE true
  END AS multi_worker_conflict,
  e.workers_seen,
  e.hosts_seen,
  CASE
    WHEN e.failed_at IS NOT NULL    THEN 'FAILED'
    WHEN e.discarded_at IS NOT NULL THEN 'DISCARDED'
    WHEN e.finished_at IS NOT NULL  THEN 'FINISHED'
    WHEN e.snapshot_sent_at IS NOT NULL  THEN 'SNAPSHOT_SENT'
    WHEN e.print_uploaded_at IS NOT NULL THEN 'PRINT_UPLOADED'
    WHEN e.started_at IS NOT NULL        THEN 'STARTED'
    WHEN e.queued_local_at IS NOT NULL   THEN 'QUEUED_LOCAL'
    WHEN e.accepted_at IS NOT NULL       THEN 'ACCEPTED'
    WHEN e.fetched_at IS NOT NULL        THEN 'FETCHED'
    ELSE 'UNKNOWN'
  END AS current_state,
  e.fetched_at, e.accepted_at, e.queued_local_at, e.started_at,
  e.print_uploaded_at, e.snapshot_sent_at, e.finished_at,
  e.failed_at, e.discarded_at, e.discard_reason, e.failure_message,
  EXTRACT(EPOCH FROM (e.accepted_at       - e.fetched_at))        AS dur_fetched_to_accepted_s,
  EXTRACT(EPOCH FROM (e.started_at        - COALESCE(e.queued_local_at, e.accepted_at, e.fetched_at))) AS dur_queue_to_started_s,
  EXTRACT(EPOCH FROM (e.print_uploaded_at - e.started_at))        AS dur_started_to_print_s,
  EXTRACT(EPOCH FROM (e.snapshot_sent_at  - e.print_uploaded_at)) AS dur_print_to_snapshot_s,
  EXTRACT(EPOCH FROM (e.finished_at       - e.fetched_at))        AS dur_total_s,
  e.total_events,
  b.batch_id, b.batch_status, b.received_parts, b.total_parts,
  COALESCE(s.snapshot_count, 0)            AS snapshot_count,
  COALESCE(s.total_plays_extracted, 0)::bigint AS total_plays_extracted,
  s.first_snapshot_at, s.last_snapshot_at,
  h.last_heartbeat_at, h.last_heartbeat_host,
  h.processing_correlation_ids AS worker_processing_now
FROM evs e
LEFT JOIN batches b ON b.correlation_id = e.correlation_id
LEFT JOIN snaps   s ON s.correlation_id = e.correlation_id
LEFT JOIN last_hb h ON h.worker_id      = e.worker_id;
