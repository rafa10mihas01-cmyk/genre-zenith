CREATE TABLE IF NOT EXISTS public.sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'manual',
  synced int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  recalculated int NOT NULL DEFAULT 0,
  errors jsonb,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sync_log" ON public.sync_log FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS sync_log_created_idx ON public.sync_log(created_at DESC);