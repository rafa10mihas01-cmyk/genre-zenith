
-- Telemetria e guard da Fase 1 de aposentadoria do autopilot/CO Apify.
-- Default: tudo INERTE. Só passa a recusar inserts quando GUC for ligada.

CREATE TABLE IF NOT EXISTS public.deprecation_hits (
  id          BIGSERIAL PRIMARY KEY,
  function_name TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'unknown',
  caller_user_id UUID,
  request_meta JSONB,
  called_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deprecation_hits_called_at
  ON public.deprecation_hits (called_at DESC);
CREATE INDEX IF NOT EXISTS idx_deprecation_hits_fn_called
  ON public.deprecation_hits (function_name, called_at DESC);

ALTER TABLE public.deprecation_hits ENABLE ROW LEVEL SECURITY;

-- Service role já bypassa RLS. Admin via has_role pode ler do painel.
CREATE POLICY "admins read deprecation_hits"
  ON public.deprecation_hits FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.deprecation_blocked_jobs (
  id          BIGSERIAL PRIMARY KEY,
  job_type    TEXT NOT NULL,
  payload     JSONB,
  blocked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deprecation_blocked_jobs_at
  ON public.deprecation_blocked_jobs (blocked_at DESC);

ALTER TABLE public.deprecation_blocked_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read deprecation_blocked_jobs"
  ON public.deprecation_blocked_jobs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Guard de inserts em jobs_queue: SOMENTE ativo quando app.deprecation_phase1='on'
CREATE OR REPLACE FUNCTION public.guard_deprecated_jobs_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  flag TEXT;
  blocked TEXT[] := ARRAY[
    'autopilot','genre-autopilot','autopilot-all-genres',
    'collect-batch','daily-collect',
    'run-search','enrich-playlists',
    'genre-backfill','cron-backfill-dead',
    'auto-replicate-playlists','replicate-top',
    'generate-templates','extract-blueprints',
    'create-spotify-playlist','generate-terms',
    'learning-loop','analyze-genre','analyze-genre-visual-dna',
    'fetch-tracks-spotify','fetch-spotify-featured',
    'genre-competitors-sync','seed-editorial-terms',
    'extract-replication-rules','revalidate-dataset',
    'generate-cover-variations','generate-playlists-briefing',
    'score-templates','expire-stale-templates'
  ];
BEGIN
  BEGIN
    flag := current_setting('app.deprecation_phase1', true);
  EXCEPTION WHEN OTHERS THEN
    flag := NULL;
  END;

  IF flag = 'on' AND NEW.job_type = ANY(blocked) THEN
    INSERT INTO public.deprecation_blocked_jobs (job_type, payload)
      VALUES (NEW.job_type, to_jsonb(NEW));
    RAISE EXCEPTION 'deprecated_phase1: job_type % is disabled', NEW.job_type
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='jobs_queue') THEN
    DROP TRIGGER IF EXISTS guard_deprecated_jobs ON public.jobs_queue;
    CREATE TRIGGER guard_deprecated_jobs
      BEFORE INSERT ON public.jobs_queue
      FOR EACH ROW EXECUTE FUNCTION public.guard_deprecated_jobs_fn();
  END IF;
END $$;
