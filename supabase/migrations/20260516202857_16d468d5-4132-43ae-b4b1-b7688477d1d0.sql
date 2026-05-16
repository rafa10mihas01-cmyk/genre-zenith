
CREATE TABLE IF NOT EXISTS public.deprecation_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deprecation_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "flags read auth" ON public.deprecation_flags;
CREATE POLICY "flags read auth" ON public.deprecation_flags
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "flags admin write" ON public.deprecation_flags;
CREATE POLICY "flags admin write" ON public.deprecation_flags
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.deprecation_flags(key, enabled) VALUES ('phase1', true)
ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();

CREATE OR REPLACE FUNCTION public.deprecation_block_jobs_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_on boolean;
BEGIN
  SELECT enabled INTO is_on FROM public.deprecation_flags WHERE key = 'phase1';
  IF COALESCE(is_on, false) AND NEW.job_type = ANY (ARRAY[
    'autopilot','autopilot_all','genre_autopilot','genre_backfill','run_search',
    'collect_batch','daily_collect','enrich_playlists','extract_blueprints',
    'extract_replication_rules','generate_templates','generate_terms','score_templates',
    'seed_editorial_terms','expire_stale_templates','replicate_top','auto_replicate',
    'create_spotify_playlist','generate_cover_variations','analyze_genre',
    'analyze_genre_visual_dna','fetch_spotify_featured','fetch_tracks_spotify',
    'genre_competitors_sync','learning_loop','revalidate_dataset','cron_backfill_dead'
  ]) THEN
    INSERT INTO public.deprecation_blocked_jobs(job_type, payload, reason)
    VALUES (NEW.job_type, to_jsonb(NEW), 'phase1_killswitch');
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
