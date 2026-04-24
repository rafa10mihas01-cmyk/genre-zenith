-- ============================================================
-- FASE A.3 — Lock transacional para autopilot_runs
-- ============================================================
-- Garante 1 run "running" por gênero por vez (evita duplicação por concorrência)
CREATE UNIQUE INDEX IF NOT EXISTS idx_autopilot_runs_unique_running
  ON public.autopilot_runs (genre_id)
  WHERE status = 'running';

-- ============================================================
-- FASE B.1 — CHECK constraints em status / performance_class / quality_tier
-- ============================================================
-- playlist_templates.performance_class
ALTER TABLE public.playlist_templates
  DROP CONSTRAINT IF EXISTS playlist_templates_performance_class_check;
ALTER TABLE public.playlist_templates
  ADD CONSTRAINT playlist_templates_performance_class_check
  CHECK (performance_class IS NULL OR performance_class IN ('alta','media','baixa'));

-- playlist_templates.status
-- Antes de criar a constraint, normaliza qualquer valor legado fora do conjunto
UPDATE public.playlist_templates
   SET status = 'created'
 WHERE status = 'published';

ALTER TABLE public.playlist_templates
  DROP CONSTRAINT IF EXISTS playlist_templates_status_check;
ALTER TABLE public.playlist_templates
  ADD CONSTRAINT playlist_templates_status_check
  CHECK (status IN ('pending','approved','created','archived','rejected'));

-- playlist_templates.quality_tier (formaliza o que o trigger já valida)
ALTER TABLE public.playlist_templates
  DROP CONSTRAINT IF EXISTS playlist_templates_quality_tier_check;
ALTER TABLE public.playlist_templates
  ADD CONSTRAINT playlist_templates_quality_tier_check
  CHECK (quality_tier IN ('hot','medium','weak','archived'));

-- replications.status
UPDATE public.replications
   SET status = 'created'
 WHERE status = 'published';

ALTER TABLE public.replications
  DROP CONSTRAINT IF EXISTS replications_status_check;
ALTER TABLE public.replications
  ADD CONSTRAINT replications_status_check
  CHECK (status IN ('pending','created','error','parcial'));

-- ============================================================
-- FASE B.2 — Backfill residual: followers_at_creation = 0 → NULL
-- ============================================================
-- Templates sem snapshot ficam NULL para get_performance_dataset retornar
-- crescimento_percentual = NULL em vez de inflar métricas com baseline 0.
UPDATE public.playlist_templates t
   SET followers_at_creation = NULL
 WHERE followers_at_creation = 0
   AND NOT EXISTS (
     SELECT 1 FROM public.playlist_metrics_snapshots s
      WHERE s.template_id = t.id
   );