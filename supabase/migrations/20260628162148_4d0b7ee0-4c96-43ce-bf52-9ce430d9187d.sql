
UPDATE public.system_flags
SET engine_natural_distribution_window_days = 1,
    engine_natural_distribution_max_per_track_per_day = 200,
    engine_natural_distribution_wave_size = 200,
    catalog_executor_per_minute_limit = 30,
    updated_at = now();

WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY priority DESC NULLS LAST, scheduled_for, created_at) AS rn
  FROM public.catalog_placements
  WHERE status = 'pending'
)
UPDATE public.catalog_placements cp
SET scheduled_for = now() + ((ranked.rn - 1) * interval '2 seconds')
FROM ranked
WHERE cp.id = ranked.id;
