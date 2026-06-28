
-- =========================================================================
-- 1) Tabela de contadores diários
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.catalog_distribution_counters (
  day        date    NOT NULL,
  scope      text    NOT NULL CHECK (scope IN ('GLOBAL','OWNER','APP')),
  scope_id   text    NOT NULL DEFAULT '',
  count      integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, scope, scope_id)
);

GRANT SELECT ON public.catalog_distribution_counters TO authenticated;
GRANT ALL    ON public.catalog_distribution_counters TO service_role;

ALTER TABLE public.catalog_distribution_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team can read counters" ON public.catalog_distribution_counters;
CREATE POLICY "team can read counters"
  ON public.catalog_distribution_counters
  FOR SELECT
  TO authenticated
  USING (public.has_team_access());

CREATE INDEX IF NOT EXISTS idx_catalog_counters_day_scope
  ON public.catalog_distribution_counters(day, scope);

-- =========================================================================
-- 2) Cotas em system_flags
-- =========================================================================
ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS catalog_max_daily_per_owner integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS catalog_max_daily_per_app   integer NOT NULL DEFAULT 800;

UPDATE public.system_flags
SET catalog_max_daily_distributions = 400,
    catalog_max_daily_per_owner     = 300,
    catalog_max_daily_per_app       = 800;

-- =========================================================================
-- 3) Trigger que incrementa contadores em sucessos reais
-- =========================================================================
CREATE OR REPLACE FUNCTION public.trg_bump_catalog_counters()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_day    date;
  v_owner  text;
  v_app    text;
BEGIN
  IF NEW.outcome NOT IN ('active','success') THEN
    RETURN NEW;
  END IF;

  v_day := (COALESCE(NEW.executed_at, now()) AT TIME ZONE 'America/Sao_Paulo')::date;

  SELECT mp.owner_spotify_user_id, sut.app_id::text
    INTO v_owner, v_app
  FROM public.managed_playlists mp
  LEFT JOIN public.spotify_user_tokens sut
    ON sut.spotify_user_id = mp.owner_spotify_user_id
   AND sut.refresh_token IS NOT NULL AND sut.refresh_token <> ''
  WHERE mp.id = NEW.managed_playlist_id
  LIMIT 1;

  -- GLOBAL
  INSERT INTO public.catalog_distribution_counters(day, scope, scope_id, count, updated_at)
  VALUES (v_day, 'GLOBAL', '', 1, now())
  ON CONFLICT (day, scope, scope_id)
  DO UPDATE SET count = catalog_distribution_counters.count + 1, updated_at = now();

  -- OWNER
  IF v_owner IS NOT NULL AND v_owner <> '' THEN
    INSERT INTO public.catalog_distribution_counters(day, scope, scope_id, count, updated_at)
    VALUES (v_day, 'OWNER', v_owner, 1, now())
    ON CONFLICT (day, scope, scope_id)
    DO UPDATE SET count = catalog_distribution_counters.count + 1, updated_at = now();
  END IF;

  -- APP
  IF v_app IS NOT NULL AND v_app <> '' THEN
    INSERT INTO public.catalog_distribution_counters(day, scope, scope_id, count, updated_at)
    VALUES (v_day, 'APP', v_app, 1, now())
    ON CONFLICT (day, scope, scope_id)
    DO UPDATE SET count = catalog_distribution_counters.count + 1, updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_catalog_log_bump_counters ON public.catalog_placement_execution_log;
CREATE TRIGGER trg_catalog_log_bump_counters
  AFTER INSERT ON public.catalog_placement_execution_log
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_bump_catalog_counters();

-- =========================================================================
-- 4) Seed dos contadores do dia corrente (a partir do log de hoje)
-- =========================================================================
WITH today_log AS (
  SELECT l.managed_playlist_id, l.executed_at
  FROM public.catalog_placement_execution_log l
  WHERE l.outcome IN ('active','success')
    AND (l.executed_at AT TIME ZONE 'America/Sao_Paulo')::date
        = (now() AT TIME ZONE 'America/Sao_Paulo')::date
),
joined AS (
  SELECT
    (now() AT TIME ZONE 'America/Sao_Paulo')::date AS day,
    mp.owner_spotify_user_id AS owner_id,
    sut.app_id::text AS app_id
  FROM today_log tl
  JOIN public.managed_playlists mp ON mp.id = tl.managed_playlist_id
  LEFT JOIN public.spotify_user_tokens sut
    ON sut.spotify_user_id = mp.owner_spotify_user_id
   AND sut.refresh_token IS NOT NULL AND sut.refresh_token <> ''
)
INSERT INTO public.catalog_distribution_counters(day, scope, scope_id, count)
SELECT day, 'GLOBAL', '', COUNT(*)::int FROM joined GROUP BY day
UNION ALL
SELECT day, 'OWNER', owner_id, COUNT(*)::int FROM joined
  WHERE owner_id IS NOT NULL AND owner_id <> ''
  GROUP BY day, owner_id
UNION ALL
SELECT day, 'APP', app_id, COUNT(*)::int FROM joined
  WHERE app_id IS NOT NULL AND app_id <> ''
  GROUP BY day, app_id
ON CONFLICT (day, scope, scope_id) DO UPDATE
  SET count = EXCLUDED.count, updated_at = now();

-- =========================================================================
-- 5) claim_next_catalog_placements — Round Robin + cotas hierárquicas
-- =========================================================================
CREATE OR REPLACE FUNCTION public.claim_next_catalog_placements(_worker text, _limit integer DEFAULT 50)
RETURNS SETOF public.catalog_placements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today        date;
  v_max_global   integer;
  v_max_owner    integer;
  v_max_app      integer;
  v_done_global  integer;
  v_remaining    integer;
  v_effective    integer;
BEGIN
  PERFORM public.fn_sanitize_catalog_pending(2000);

  SELECT COALESCE(catalog_max_daily_distributions, 400),
         COALESCE(catalog_max_daily_per_owner, 300),
         COALESCE(catalog_max_daily_per_app,   800)
    INTO v_max_global, v_max_owner, v_max_app
  FROM public.system_flags ORDER BY id LIMIT 1;

  v_today := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  -- Cota GLOBAL via contador O(1)
  SELECT COALESCE(count, 0) INTO v_done_global
  FROM public.catalog_distribution_counters
  WHERE day = v_today AND scope = 'GLOBAL' AND scope_id = '';
  v_done_global := COALESCE(v_done_global, 0);

  v_remaining := GREATEST(0, v_max_global - v_done_global);
  IF v_remaining <= 0 THEN RETURN; END IF;

  v_effective := LEAST(GREATEST(1, _limit), v_remaining, 500);

  RETURN QUERY
  WITH base AS (
    SELECT
      cp.id,
      cp.status                 AS prev_status,
      cp.catalog_track_id,
      cp.priority,
      cp.scheduled_for,
      cp.created_at,
      mp.owner_spotify_user_id  AS owner_id,
      sut.app_id::text          AS app_id
    FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    JOIN public.catalog_tracks    ct ON ct.id = cp.catalog_track_id
    JOIN public.spotify_user_tokens sut
      ON sut.spotify_user_id = mp.owner_spotify_user_id
     AND sut.refresh_token IS NOT NULL AND sut.refresh_token <> ''
    WHERE cp.status IN ('pending','retry','waiting_circuit_breaker','skipped')
      AND cp.scheduled_for <= now()
      AND cp.attempts < cp.max_attempts
      AND mp.playlist_type IN ('CAMPAIGN'::public.playlist_type_enum, 'CATALOG'::public.playlist_type_enum)
      AND mp.execution_mode = 'API_READY'::playlist_execution_mode
      AND mp.spotify_playlist_id IS NOT NULL AND mp.spotify_playlist_id <> ''
      AND ct.spotify_track_id   IS NOT NULL AND ct.spotify_track_id   <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM public.spotify_circuit_breaker scb
        WHERE scb.app_id = sut.app_id::text
          AND scb.status = 'open'
          AND (scb.blocked_until IS NULL OR scb.blocked_until > now())
      )
  ),
  enriched AS (
    SELECT
      b.*,
      COALESCE(co.count, 0) AS owner_count_today,
      COALESCE(ca.count, 0) AS app_count_today
    FROM base b
    LEFT JOIN public.catalog_distribution_counters co
      ON co.day = v_today AND co.scope = 'OWNER' AND co.scope_id = b.owner_id
    LEFT JOIN public.catalog_distribution_counters ca
      ON ca.day = v_today AND ca.scope = 'APP'   AND ca.scope_id = b.app_id
    WHERE COALESCE(co.count, 0) < v_max_owner
      AND COALESCE(ca.count, 0) < v_max_app
  ),
  ordered AS (
    SELECT
      e.*,
      ROW_NUMBER() OVER (
        PARTITION BY e.catalog_track_id
        ORDER BY e.priority ASC, e.scheduled_for ASC, e.created_at ASC
      ) AS rn_track
    FROM enriched e
  ),
  eligible AS (
    SELECT o.id, o.prev_status
    FROM ordered o
    JOIN public.catalog_placements cp ON cp.id = o.id
    ORDER BY
      o.priority             ASC,
      o.rn_track             ASC,   -- Round Robin entre músicas
      o.owner_count_today    ASC,   -- owner menos utilizado
      o.app_count_today      ASC,   -- app menos utilizado
      o.scheduled_for        ASC,
      o.created_at           ASC
    LIMIT v_effective
    FOR UPDATE OF cp SKIP LOCKED
  )
  UPDATE public.catalog_placements p
  SET status           = 'processing',
      locked_at        = now(),
      locked_by        = _worker,
      lease_expires_at = now() + interval '2 minutes',
      attempts         = CASE
        WHEN eligible.prev_status IN ('waiting_circuit_breaker','skipped') THEN p.attempts
        ELSE p.attempts + 1
      END
  FROM eligible
  WHERE p.id = eligible.id
  RETURNING p.*;
END;
$function$;
