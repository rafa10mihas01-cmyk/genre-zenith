
UPDATE public.system_flags
   SET catalog_max_daily_distributions = 200,
       updated_at = now()
 WHERE id = (SELECT id FROM public.system_flags ORDER BY id LIMIT 1);
