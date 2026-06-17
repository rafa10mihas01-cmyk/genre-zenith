
-- 1) Add correlation_id (additive, nullable) to tables that don't have it yet
ALTER TABLE public.collection_logs              ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE public.curator_deal_logs            ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE public.delivery_proofs              ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE public.campaign_playlist_collections ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE public.playlist_operation_log       ADD COLUMN IF NOT EXISTS correlation_id text;

CREATE INDEX IF NOT EXISTS idx_collection_logs_corr               ON public.collection_logs(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_curator_deal_logs_corr             ON public.curator_deal_logs(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_proofs_corr               ON public.delivery_proofs(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_playlist_collections_corr ON public.campaign_playlist_collections(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_playlist_operation_log_corr        ON public.playlist_operation_log(correlation_id) WHERE correlation_id IS NOT NULL;

-- 2) Health probes (uniforme p/ OCR/Browser/SMTP/Gateway/Match/Writer/Delivery/Parser)
CREATE TABLE IF NOT EXISTS public.health_probes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  probe_name text NOT NULL,
  subsystem  text NOT NULL,          -- ocr|browser|smtp|gateway|match|writer|delivery|parser|...
  status     text NOT NULL,          -- ok|degraded|down
  latency_ms integer,
  last_success_at timestamptz,
  last_error_at   timestamptz,
  last_error_msg  text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_probes_subsystem_created ON public.health_probes(subsystem, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_probes_status            ON public.health_probes(status) WHERE status <> 'ok';

GRANT SELECT ON public.health_probes TO authenticated;
GRANT ALL    ON public.health_probes TO service_role;
ALTER TABLE public.health_probes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "health_probes admin read" ON public.health_probes
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "health_probes service write" ON public.health_probes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3) System alerts (fila oficial, dedupe, ack, resolução)
CREATE TABLE IF NOT EXISTS public.system_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  subsystem text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  dedupe_key text,
  cooldown_minutes integer NOT NULL DEFAULT 60,
  channels text[] NOT NULL DEFAULT ARRAY['inapp']::text[],  -- inapp|email|webhook|slack
  correlation_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivered_at  timestamptz,
  acked_at      timestamptz,
  acked_by      uuid,
  resolved_at   timestamptz,
  resolution    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_alerts_open
  ON public.system_alerts(severity, created_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_system_alerts_dedupe
  ON public.system_alerts(dedupe_key, created_at DESC) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_alerts_corr
  ON public.system_alerts(correlation_id) WHERE correlation_id IS NOT NULL;

GRANT SELECT, UPDATE ON public.system_alerts TO authenticated;
GRANT ALL ON public.system_alerts TO service_role;
ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "system_alerts admin read"   ON public.system_alerts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "system_alerts admin ack"    ON public.system_alerts
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "system_alerts service all"  ON public.system_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
