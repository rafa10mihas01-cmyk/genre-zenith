CREATE OR REPLACE FUNCTION public.check_catalog_placements_null_position()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_sample text;
BEGIN
  SELECT count(*), string_agg(DISTINCT managed_playlist_id::text, ', ' ORDER BY managed_playlist_id::text) FILTER (WHERE managed_playlist_id IS NOT NULL)
    INTO v_count, v_sample
    FROM public.catalog_placements
   WHERE status = 'active'
     AND position IS NULL
     AND created_at > now() - interval '2 hours';

  IF v_count > 0 THEN
    INSERT INTO public.system_alerts (severity, subsystem, title, message, dedupe_key, cooldown_minutes, metadata)
    VALUES (
      'warning',
      'catalog-placements',
      'Placement de catálogo sem posição detectado',
      format('%s placement(s) ativo(s) criado(s) nas últimas 2h sem posição definida. Playlists: %s', v_count, COALESCE(left(v_sample, 300), 'n/a')),
      'catalog_placements_null_position',
      120,
      jsonb_build_object('count', v_count, 'window', '2h')
    );
  END IF;
END;
$$;

SELECT cron.schedule(
  'check-catalog-placements-null-position',
  '0 * * * *',
  $$ SELECT public.check_catalog_placements_null_position(); $$
);