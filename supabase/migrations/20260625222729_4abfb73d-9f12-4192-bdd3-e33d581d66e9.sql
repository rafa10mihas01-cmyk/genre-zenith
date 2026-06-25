
CREATE OR REPLACE FUNCTION public.catalog_daily_distribution_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit    integer;
  v_done     integer;
  v_by_owner jsonb;
BEGIN
  SELECT COALESCE(catalog_max_daily_distributions, 200)
    INTO v_limit
  FROM public.system_flags
  ORDER BY id
  LIMIT 1;

  IF v_limit IS NULL THEN v_limit := 200; END IF;

  SELECT COUNT(*)::int
    INTO v_done
  FROM public.catalog_placement_execution_log
  WHERE outcome = 'success'
    AND (executed_at AT TIME ZONE 'America/Sao_Paulo')::date
        = (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.count DESC), '[]'::jsonb)
    INTO v_by_owner
  FROM (
    SELECT COALESCE(a.display_name, a.email, 'sem conta') AS owner,
           COUNT(*)::int AS count
    FROM public.catalog_placement_execution_log l
    JOIN public.managed_playlists mp ON mp.id = l.managed_playlist_id
    LEFT JOIN public.accounts a ON a.id = mp.account_id
    WHERE l.outcome = 'success'
      AND (l.executed_at AT TIME ZONE 'America/Sao_Paulo')::date
          = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    GROUP BY 1
    ORDER BY 2 DESC
  ) r;

  RETURN jsonb_build_object(
    'limit',          v_limit,
    'executed_today', COALESCE(v_done, 0),
    'remaining',      GREATEST(0, v_limit - COALESCE(v_done, 0)),
    'by_owner',       v_by_owner
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.catalog_daily_distribution_stats() TO authenticated, service_role;
