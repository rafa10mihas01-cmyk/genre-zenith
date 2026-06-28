
-- =====================================================================
-- ETAPA 4 — Destruição da infraestrutura do antigo Occupancy Engine.
-- =====================================================================

-- 1) Cron jobs antigos (mantém apenas occupancy-executor-1min ativo,
--    que aponta para o endpoint refatorado).
DO $$
DECLARE jobid bigint;
BEGIN
  FOR jobid IN
    SELECT j.jobid FROM cron.job j
    WHERE j.jobname IN ('occupancy-rebuild-worker-every-minute','occupancy-executor-minute')
  LOOP
    PERFORM cron.unschedule(jobid);
  END LOOP;
END $$;

-- 2) Triggers que disparavam rebuild a cada mudança de estado.
DROP TRIGGER IF EXISTS trg_occ_cp_aiud ON public.catalog_placements;
DROP TRIGGER IF EXISTS trg_occ_mpt_ai ON public.managed_playlist_tracks;
DROP TRIGGER IF EXISTS trg_occ_mpt_au ON public.managed_playlist_tracks;
DROP TRIGGER IF EXISTS trg_occ_mpt_ad ON public.managed_playlist_tracks;
DROP TRIGGER IF EXISTS trg_occ_policy_aiud ON public.playlist_editorial_policies;
DROP TRIGGER IF EXISTS trg_occ_campaign_lc ON public.campaigns;

DROP FUNCTION IF EXISTS public.trg_occ_catalog_placement_changed() CASCADE;
DROP FUNCTION IF EXISTS public.trg_occ_mpt_changed() CASCADE;
DROP FUNCTION IF EXISTS public.trg_occ_policy_changed() CASCADE;
DROP FUNCTION IF EXISTS public.trg_occ_campaign_lifecycle() CASCADE;

-- 3) Funções do motor antigo.
DROP FUNCTION IF EXISTS public.fn_enqueue_occupancy_rebuild(uuid, text, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.fn_process_occupancy_rebuild_queue(integer) CASCADE;
DROP FUNCTION IF EXISTS public.fn_playlist_occupancy_rebuild(uuid, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.fn_playlist_occupancy_rebuild_batch(integer, text) CASCADE;
DROP FUNCTION IF EXISTS public.fn_occupancy_claim_executable_plans(integer) CASCADE;

-- 4) Recria stats removendo dependência das tabelas que serão dropadas.
CREATE OR REPLACE FUNCTION public.catalog_daily_distribution_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  FROM public.catalog_placement_execution_log l
  WHERE l.outcome IN ('active','success')
    AND (l.executed_at AT TIME ZONE 'America/Sao_Paulo')::date
        = (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.count DESC), '[]'::jsonb)
    INTO v_by_owner
  FROM (
    SELECT COALESCE(a.display_name, a.email, mp.owner_spotify_user_id, 'sem conta') AS owner,
           COUNT(*)::int AS count
    FROM public.catalog_placement_execution_log l
    JOIN public.managed_playlists mp ON mp.id = l.managed_playlist_id
    LEFT JOIN public.accounts a ON a.id = mp.account_id
    WHERE l.outcome IN ('active','success')
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
$function$;

-- 5) Tabelas (CASCADE remove FKs/índices/sequences associados).
DROP TABLE IF EXISTS public.occupancy_plan_ops CASCADE;
DROP TABLE IF EXISTS public.occupancy_plans CASCADE;
DROP TABLE IF EXISTS public.occupancy_rebuild_queue CASCADE;

-- 6) Colunas obsoletas de system_flags.
ALTER TABLE public.system_flags
  DROP COLUMN IF EXISTS occupancy_engine_mode,
  DROP COLUMN IF EXISTS occupancy_executor_per_minute_limit,
  DROP COLUMN IF EXISTS occupancy_max_daily_operations;
