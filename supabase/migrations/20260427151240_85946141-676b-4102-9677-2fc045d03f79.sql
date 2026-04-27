
CREATE TABLE IF NOT EXISTS public.genre_backfill_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id uuid NOT NULL,
  triggered_by text NOT NULL DEFAULT 'cron', -- cron | autopilot_hook | manual
  status text NOT NULL DEFAULT 'running',     -- running | success | error | skipped
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duracao_ms integer
);

CREATE INDEX IF NOT EXISTS idx_gba_genre_started
  ON public.genre_backfill_attempts (genre_id, started_at DESC);

ALTER TABLE public.genre_backfill_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_select_gba ON public.genre_backfill_attempts
  FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY team_insert_gba ON public.genre_backfill_attempts
  FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY team_update_gba ON public.genre_backfill_attempts
  FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY team_delete_gba ON public.genre_backfill_attempts
  FOR DELETE TO authenticated USING (public.has_team_access());

CREATE OR REPLACE FUNCTION public.count_recent_backfill_attempts(p_genre_id uuid, p_hours integer DEFAULT 24)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.genre_backfill_attempts
  WHERE genre_id = p_genre_id
    AND started_at > now() - make_interval(hours => p_hours);
$$;
