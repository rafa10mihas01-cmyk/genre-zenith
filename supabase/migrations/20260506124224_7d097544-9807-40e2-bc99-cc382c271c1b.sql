-- ============================================================
-- FASE 6 — Observabilidade + retenção
-- ============================================================

-- 1) Tabela ops_metrics
CREATE TABLE IF NOT EXISTS public.ops_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  scope text NOT NULL,
  operation text NOT NULL,
  status text NOT NULL DEFAULT 'success',
  duration_ms integer,
  deal_id uuid,
  song_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ops_metrics_op_time
  ON public.ops_metrics (scope, operation, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_metrics_status_time
  ON public.ops_metrics (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_metrics_created_at
  ON public.ops_metrics (created_at DESC);

ALTER TABLE public.ops_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_select_ops_metrics ON public.ops_metrics;
CREATE POLICY team_select_ops_metrics ON public.ops_metrics
  FOR SELECT TO authenticated
  USING (public.has_team_access());

DROP POLICY IF EXISTS team_delete_ops_metrics ON public.ops_metrics;
CREATE POLICY team_delete_ops_metrics ON public.ops_metrics
  FOR DELETE TO authenticated
  USING (public.has_team_access());

-- Insert: edge functions usam service_role (bypass RLS); usuários autenticados não escrevem.

-- 2) View de crescimento de storage (payloads JSON pesados)
CREATE OR REPLACE VIEW public.v_storage_growth AS
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

-- 3) Função de limpeza retentiva (SAFE: só logs operacionais)
CREATE OR REPLACE FUNCTION public.cleanup_operational_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_heartbeats int;
  v_coll_logs int;
  v_bot_events int;
  v_metrics int;
BEGIN
  -- bot_heartbeats: 7 dias
  WITH d AS (
    DELETE FROM public.bot_heartbeats
     WHERE created_at < now() - interval '7 days'
     RETURNING 1
  ) SELECT count(*) INTO v_heartbeats FROM d;

  -- collection_logs: 30 dias
  WITH d AS (
    DELETE FROM public.collection_logs
     WHERE created_at < now() - interval '30 days'
     RETURNING 1
  ) SELECT count(*) INTO v_coll_logs FROM d;

  -- bot_events: 30 dias geral, 90 dias para errors/critical
  WITH d AS (
    DELETE FROM public.bot_events
     WHERE (
       (status NOT IN ('error', 'critical', 'failed') AND created_at < now() - interval '30 days')
       OR (status IN ('error', 'critical', 'failed') AND created_at < now() - interval '90 days')
     )
     RETURNING 1
  ) SELECT count(*) INTO v_bot_events FROM d;

  -- ops_metrics: 30 dias
  WITH d AS (
    DELETE FROM public.ops_metrics
     WHERE created_at < now() - interval '30 days'
     RETURNING 1
  ) SELECT count(*) INTO v_metrics FROM d;

  RETURN jsonb_build_object(
    'bot_heartbeats_deleted', v_heartbeats,
    'collection_logs_deleted', v_coll_logs,
    'bot_events_deleted', v_bot_events,
    'ops_metrics_deleted', v_metrics,
    'completed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_operational_logs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_operational_logs() TO authenticated;