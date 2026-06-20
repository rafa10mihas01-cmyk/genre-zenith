
-- ============================================================
-- Fase 16 — Arquitetura Definitiva do Balanceador Spotify
-- Migration ADITIVA: nada é movido, removido ou reescrito.
-- ============================================================

ALTER TABLE public.spotify_apps
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'hybrid',
  ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS max_playlists integer NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS cap_calls_per_minute integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS cap_calls_per_hour integer NOT NULL DEFAULT 6000,
  ADD COLUMN IF NOT EXISTS soft_capacity_cap smallint NOT NULL DEFAULT 85,
  ADD COLUMN IF NOT EXISTS min_health_score smallint NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS removed_from_pool_at timestamptz,
  ADD COLUMN IF NOT EXISTS extended_quota boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS development_mode boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.spotify_apps ADD CONSTRAINT spotify_apps_purpose_chk
    CHECK (purpose IN ('write','enrich','hybrid'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.spotify_apps ADD CONSTRAINT spotify_apps_lifecycle_chk
    CHECK (lifecycle_state IN ('active','maintenance','quarantined','development_blocked','disabled','retired'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.spotify_apps
SET purpose = CASE WHEN lower(name) LIKE '%10%' THEN 'enrich' ELSE 'write' END
WHERE purpose = 'hybrid';

UPDATE public.spotify_apps
SET lifecycle_state = CASE
  WHEN status = 'retired' THEN 'retired'
  WHEN quarantined_until IS NOT NULL AND quarantined_until > now() + interval '50 years' THEN 'development_blocked'
  WHEN quarantined_until IS NOT NULL AND quarantined_until > now() THEN 'quarantined'
  WHEN status = 'active' THEN 'active'
  ELSE 'disabled'
END,
development_mode = (quarantined_until IS NOT NULL AND quarantined_until > now() + interval '50 years'),
blocked_reason = CASE
  WHEN quarantined_until IS NOT NULL AND quarantined_until > now() + interval '50 years' THEN 'development_mode'
  WHEN quarantined_until IS NOT NULL AND quarantined_until > now() THEN 'rate_limit'
  ELSE blocked_reason
END;

CREATE INDEX IF NOT EXISTS idx_spotify_call_log_app_created
  ON public.spotify_call_log (app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spotify_user_tokens_app
  ON public.spotify_user_tokens (app_id);

CREATE OR REPLACE VIEW public.spotify_app_overview AS
WITH calls AS (
  SELECT app_id,
    COUNT(*) FILTER (WHERE created_at > now() - interval '5 minutes')  AS calls_5m,
    COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour')     AS calls_1h,
    COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')   AS calls_24h,
    COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')     AS calls_7d,
    COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour' AND http_status = 403) AS err_403_1h,
    COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour' AND http_status = 429) AS err_429_1h,
    COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour' AND status = 'retry')  AS retries_1h,
    AVG(duration_ms) FILTER (WHERE created_at > now() - interval '1 hour')               AS avg_ms_1h
  FROM public.spotify_call_log
  WHERE app_id IS NOT NULL
  GROUP BY app_id
),
accounts_per_app AS (
  SELECT app_id, COUNT(*)::int AS accounts_count
  FROM public.spotify_user_tokens
  WHERE app_id IS NOT NULL
  GROUP BY app_id
),
playlists_per_app AS (
  SELECT ut.app_id,
    COUNT(*) FILTER (WHERE mp.archived_at IS NULL)::int AS active_playlists,
    COUNT(*)::int AS total_playlists
  FROM public.managed_playlists mp
  JOIN public.accounts a ON a.id = mp.account_id
  JOIN public.spotify_user_tokens ut ON ut.id = a.spotify_user_token_id
  WHERE ut.app_id IS NOT NULL
  GROUP BY ut.app_id
),
breaker AS (
  SELECT app_id, status AS circuit_breaker FROM public.spotify_circuit_breaker
)
SELECT
  a.id, a.name, a.status, a.lifecycle_state, a.purpose,
  a.is_default, a.created_at,
  a.development_mode, a.extended_quota, a.blocked_reason,
  a.quarantined_until, a.removed_from_pool_at,
  COALESCE(ac.accounts_count, 0)        AS accounts_count,
  a.max_accounts,
  COALESCE(pl.active_playlists, 0)      AS active_playlists,
  COALESCE(pl.total_playlists, 0)       AS total_playlists,
  a.max_playlists,
  COALESCE(c.calls_5m, 0)               AS calls_last_5m,
  COALESCE(c.calls_1h, 0)               AS calls_last_1h,
  COALESCE(c.calls_24h, 0)              AS calls_last_24h,
  COALESCE(c.calls_7d, 0)               AS calls_last_7d,
  a.cap_calls_per_minute, a.cap_calls_per_hour,
  COALESCE(c.err_403_1h, 0)             AS error_403_last_hour,
  COALESCE(c.err_429_1h, 0)             AS error_429_last_hour,
  COALESCE(c.retries_1h, 0)             AS retries_last_hour,
  COALESCE(c.avg_ms_1h, 0)::int         AS average_latency_ms,
  COALESCE(b.circuit_breaker, 'closed') AS circuit_breaker,
  LEAST(100, GREATEST(0, (
      0.45 * (COALESCE(c.calls_1h,0)::numeric / NULLIF(a.cap_calls_per_hour,0)::numeric * 100)
    + 0.30 * (COALESCE(pl.active_playlists,0)::numeric / NULLIF(a.max_playlists,0)::numeric * 100)
    + 0.25 * (COALESCE(ac.accounts_count,0)::numeric / NULLIF(a.max_accounts,0)::numeric * 100)
  )))::smallint AS capacity_score,
  GREATEST(0, LEAST(100, (
      100
      - LEAST(40, COALESCE(c.err_403_1h,0) * 2)
      - LEAST(30, COALESCE(c.err_429_1h,0))
      - LEAST(15, COALESCE(c.retries_1h,0))
      - CASE WHEN COALESCE(b.circuit_breaker,'closed') <> 'closed' THEN 30 ELSE 0 END
      - CASE WHEN COALESCE(c.avg_ms_1h,0) > 1500 THEN 10 ELSE 0 END
  )))::smallint AS health_score,
  a.soft_capacity_cap, a.min_health_score,
  (a.lifecycle_state = 'active'
   AND a.status = 'active'
   AND (a.quarantined_until IS NULL OR a.quarantined_until <= now())
   AND a.removed_from_pool_at IS NULL) AS pool_eligible
FROM public.spotify_apps a
LEFT JOIN calls             c  ON c.app_id  = a.id
LEFT JOIN accounts_per_app  ac ON ac.app_id = a.id
LEFT JOIN playlists_per_app pl ON pl.app_id = a.id
LEFT JOIN breaker           b  ON b.app_id  = a.id::text;

GRANT SELECT ON public.spotify_app_overview TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pick_spotify_app(p_purpose text DEFAULT 'write')
RETURNS TABLE (
  id uuid, name text, client_id text, client_secret text,
  purpose text, capacity_score smallint, health_score smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purpose text := lower(coalesce(p_purpose, 'write'));
  v_picked_id uuid;
BEGIN
  IF v_purpose NOT IN ('write','enrich','hybrid') THEN v_purpose := 'write'; END IF;

  SELECT o.id INTO v_picked_id
  FROM public.spotify_app_overview o
  WHERE o.pool_eligible = true
    AND ((v_purpose='write'  AND o.purpose IN ('write','hybrid'))
      OR (v_purpose='enrich' AND o.purpose IN ('enrich','hybrid'))
      OR (v_purpose='hybrid'))
    AND o.accounts_count   < o.max_accounts
    AND o.active_playlists < o.max_playlists
    AND o.calls_last_1h    < o.cap_calls_per_hour
    AND o.health_score    >= o.min_health_score
    AND o.capacity_score   < o.soft_capacity_cap
  ORDER BY o.capacity_score ASC, o.accounts_count ASC, o.active_playlists ASC, o.health_score DESC
  LIMIT 1;

  IF v_picked_id IS NULL THEN
    SELECT o.id INTO v_picked_id
    FROM public.spotify_app_overview o
    WHERE o.pool_eligible = true
      AND ((v_purpose='write'  AND o.purpose IN ('write','hybrid'))
        OR (v_purpose='enrich' AND o.purpose IN ('enrich','hybrid'))
        OR (v_purpose='hybrid'))
      AND o.accounts_count   < o.max_accounts
      AND o.active_playlists < o.max_playlists
      AND o.calls_last_1h    < o.cap_calls_per_hour
      AND o.health_score    >= o.min_health_score
    ORDER BY o.capacity_score ASC, o.accounts_count ASC, o.active_playlists ASC, o.health_score DESC
    LIMIT 1;
  END IF;

  IF v_picked_id IS NULL THEN RETURN; END IF;

  PERFORM 1 FROM public.spotify_apps WHERE spotify_apps.id = v_picked_id FOR UPDATE;

  RETURN QUERY
  SELECT o.id, o.name, sa.client_id, sa.client_secret, o.purpose,
         o.capacity_score, o.health_score
  FROM public.spotify_app_overview o
  JOIN public.spotify_apps sa ON sa.id = o.id
  WHERE o.id = v_picked_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pick_spotify_app(text) FROM public;
GRANT EXECUTE ON FUNCTION public.pick_spotify_app(text) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.raise_spotify_balancer_alert(
  p_app_id uuid, p_kind text, p_severity text,
  p_title text, p_message text, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dedupe text := 'spotify_balancer:' || p_kind || ':' || p_app_id::text;
  v_recent boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.system_alerts
    WHERE dedupe_key = v_dedupe AND created_at > now() - interval '30 minutes'
  ) INTO v_recent;
  IF v_recent THEN RETURN; END IF;

  INSERT INTO public.system_alerts (subsystem, severity, title, message, dedupe_key, cooldown_minutes, metadata)
  VALUES ('spotify_balancer', p_severity, p_title, p_message, v_dedupe, 30,
          p_metadata || jsonb_build_object('app_id', p_app_id));
END;
$$;

REVOKE ALL ON FUNCTION public.raise_spotify_balancer_alert(uuid,text,text,text,text,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.raise_spotify_balancer_alert(uuid,text,text,text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.sweep_spotify_balancer_alerts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.spotify_app_overview LOOP
    IF r.capacity_score >= 90 AND r.lifecycle_state='active' THEN
      PERFORM public.raise_spotify_balancer_alert(r.id, 'capacity_critical', 'critical',
        format('App %s saturada', r.name),
        format('Capacity %s%% (>= 90)', r.capacity_score),
        jsonb_build_object('capacity', r.capacity_score));
    ELSIF r.capacity_score >= 80 AND r.lifecycle_state='active' THEN
      PERFORM public.raise_spotify_balancer_alert(r.id, 'capacity_warning', 'warning',
        format('App %s perto do limite', r.name),
        format('Capacity %s%%', r.capacity_score),
        jsonb_build_object('capacity', r.capacity_score));
    END IF;

    IF r.health_score < r.min_health_score AND r.lifecycle_state='active' THEN
      PERFORM public.raise_spotify_balancer_alert(r.id, 'health_low', 'critical',
        format('App %s com saúde baixa', r.name),
        format('Health %s < min %s', r.health_score, r.min_health_score),
        jsonb_build_object('health', r.health_score));
    END IF;

    IF r.accounts_count >= GREATEST(r.max_accounts - 1, 0) AND r.lifecycle_state='active' THEN
      PERFORM public.raise_spotify_balancer_alert(r.id, 'accounts_near_cap', 'warning',
        format('App %s perto do limite de contas', r.name),
        format('%s/%s contas', r.accounts_count, r.max_accounts),
        jsonb_build_object('accounts', r.accounts_count, 'max', r.max_accounts));
    END IF;

    IF r.error_403_last_hour >= 20 THEN
      PERFORM public.raise_spotify_balancer_alert(r.id, 'err_403_spike', 'critical',
        format('Pico de 403 em %s', r.name),
        format('%s erros 403 na última hora', r.error_403_last_hour),
        jsonb_build_object('err_403', r.error_403_last_hour));
    END IF;

    IF r.error_429_last_hour >= 50 THEN
      PERFORM public.raise_spotify_balancer_alert(r.id, 'err_429_spike', 'critical',
        format('Pico de 429 em %s', r.name),
        format('%s erros 429 na última hora', r.error_429_last_hour),
        jsonb_build_object('err_429', r.error_429_last_hour));
    END IF;

    IF r.development_mode THEN
      PERFORM public.raise_spotify_balancer_alert(r.id, 'development_mode', 'warning',
        format('App %s em Development Mode', r.name),
        'Requer whitelist no Spotify Dashboard ou Extended Quota Mode',
        '{}'::jsonb);
    END IF;

    IF r.circuit_breaker <> 'closed' THEN
      PERFORM public.raise_spotify_balancer_alert(r.id, 'circuit_open', 'critical',
        format('Circuit breaker aberto em %s', r.name),
        format('Estado=%s', r.circuit_breaker),
        jsonb_build_object('state', r.circuit_breaker));
    END IF;

    IF r.lifecycle_state='active' AND r.calls_last_24h = 0 AND r.accounts_count > 0 THEN
      PERFORM public.raise_spotify_balancer_alert(r.id, 'idle_app', 'info',
        format('App %s ociosa', r.name),
        'Sem chamadas em 24h apesar de ter contas vinculadas',
        '{}'::jsonb);
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_spotify_balancer_alerts() FROM public;
GRANT EXECUTE ON FUNCTION public.sweep_spotify_balancer_alerts() TO service_role;
