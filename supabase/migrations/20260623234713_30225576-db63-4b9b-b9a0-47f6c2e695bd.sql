ALTER FUNCTION public.distribute_catalog_track_v1(text, uuid, text, text, text, text, text, integer, bigint, bigint, jsonb, uuid) SET search_path = public;
ALTER FUNCTION public.engine_create_distribution_plan_v1(uuid, smallint) SET search_path = public;
ALTER FUNCTION public.engine_run_distribution_wave_v1(integer) SET search_path = public;