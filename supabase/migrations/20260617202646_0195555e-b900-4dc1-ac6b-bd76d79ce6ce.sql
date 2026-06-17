
-- ============================================================
-- FASE 4.C.3 — Observability refinement (additive only)
-- ============================================================

-- ITEM 1 — RUM avançado: expandir client_error_log
ALTER TABLE public.client_error_log
  ADD COLUMN IF NOT EXISTS breadcrumbs JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS route_from TEXT,
  ADD COLUMN IF NOT EXISTS route_to TEXT,
  ADD COLUMN IF NOT EXISTS user_action TEXT,
  ADD COLUMN IF NOT EXISTS component TEXT,
  ADD COLUMN IF NOT EXISTS commit_sha TEXT,
  ADD COLUMN IF NOT EXISTS viewport TEXT,
  ADD COLUMN IF NOT EXISTS session_ms BIGINT,
  ADD COLUMN IF NOT EXISTS browser TEXT;

-- ITEM 3 — Audit log genérico
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id UUID,
  actor_role TEXT,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  row_pk TEXT,
  before_data JSONB,
  after_data JSONB,
  diff_keys TEXT[],
  correlation_id TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_admin_read"
  ON public.audit_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "audit_log_service_write"
  ON public.audit_log FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_time
  ON public.audit_log (table_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON public.audit_log (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_correlation
  ON public.audit_log (correlation_id) WHERE correlation_id IS NOT NULL;

-- Função genérica de auditoria
CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before JSONB;
  v_after  JSONB;
  v_pk     TEXT;
  v_corr   TEXT;
  v_src    TEXT;
  v_diff   TEXT[];
  k TEXT;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_before := to_jsonb(OLD);
    v_after  := NULL;
    v_pk     := COALESCE((v_before->>'id'), '');
  ELSIF (TG_OP = 'UPDATE') THEN
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);
    v_pk     := COALESCE((v_after->>'id'), (v_before->>'id'), '');
    v_diff   := ARRAY(
      SELECT key FROM jsonb_each(v_after) e(key, val)
      WHERE v_before -> key IS DISTINCT FROM val
    );
  ELSE -- INSERT
    v_before := NULL;
    v_after  := to_jsonb(NEW);
    v_pk     := COALESCE((v_after->>'id'), '');
  END IF;

  BEGIN
    v_corr := current_setting('app.correlation_id', true);
    v_src  := current_setting('app.audit_source', true);
  EXCEPTION WHEN OTHERS THEN
    v_corr := NULL; v_src := NULL;
  END;

  INSERT INTO public.audit_log (
    actor_id, actor_role, table_name, operation, row_pk,
    before_data, after_data, diff_keys, correlation_id, source
  ) VALUES (
    auth.uid(),
    current_user,
    TG_TABLE_NAME,
    TG_OP,
    NULLIF(v_pk, ''),
    v_before, v_after, v_diff,
    NULLIF(v_corr, ''),
    NULLIF(v_src, '')
  );

  IF (TG_OP = 'DELETE') THEN RETURN OLD; ELSE RETURN NEW; END IF;
EXCEPTION WHEN OTHERS THEN
  -- nunca quebrar mutação por falha de auditoria
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Helper pra anexar trigger
DO $$
DECLARE
  t TEXT;
  critical_tables TEXT[] := ARRAY[
    'curator_deals',
    'curator_deal_songs',
    'campaigns',
    'clients',
    'curators',
    'system_alerts',
    'system_flags',
    'pricing_settings'
  ];
BEGIN
  FOREACH t IN ARRAY critical_tables LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_audit_%1$s ON public.%1$s;
       CREATE TRIGGER trg_audit_%1$s
         AFTER INSERT OR UPDATE OR DELETE ON public.%1$s
         FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();',
      t
    );
  END LOOP;
END$$;

-- ITEM 6 — Histórico detalhado por execução de cron
CREATE TABLE IF NOT EXISTS public.cron_run_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cron_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  success BOOLEAN,
  error_message TEXT,
  retries INTEGER NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ,
  correlation_id TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.cron_run_log TO authenticated;
GRANT ALL ON public.cron_run_log TO service_role;
ALTER TABLE public.cron_run_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cron_run_log_admin_read"
  ON public.cron_run_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "cron_run_log_service_write"
  ON public.cron_run_log FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_cron_run_log_name_time
  ON public.cron_run_log (cron_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_run_log_failures
  ON public.cron_run_log (cron_name, started_at DESC) WHERE success = false;
