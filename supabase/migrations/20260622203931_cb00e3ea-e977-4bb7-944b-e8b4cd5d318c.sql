
-- 1) Normaliza purpose='enrich' (enrich pós-17-C roda via Cache + Worker, não OAuth)
UPDATE public.spotify_apps SET purpose = 'hybrid' WHERE purpose = 'enrich';

-- 2) Recria a view sem is_default
DROP VIEW IF EXISTS public.spotify_app_overview;

CREATE VIEW public.spotify_app_overview AS
 WITH calls AS (
         SELECT spotify_call_log.app_id,
            count(*) FILTER (WHERE spotify_call_log.created_at > (now() - '00:05:00'::interval)) AS calls_5m,
            count(*) FILTER (WHERE spotify_call_log.created_at > (now() - '01:00:00'::interval)) AS calls_1h,
            count(*) FILTER (WHERE spotify_call_log.created_at > (now() - '24:00:00'::interval)) AS calls_24h,
            count(*) FILTER (WHERE spotify_call_log.created_at > (now() - '7 days'::interval)) AS calls_7d,
            count(*) FILTER (WHERE spotify_call_log.created_at > (now() - '01:00:00'::interval) AND spotify_call_log.http_status = 403) AS err_403_1h,
            count(*) FILTER (WHERE spotify_call_log.created_at > (now() - '01:00:00'::interval) AND spotify_call_log.http_status = 429) AS err_429_1h,
            count(*) FILTER (WHERE spotify_call_log.created_at > (now() - '01:00:00'::interval) AND spotify_call_log.status = 'retry'::text) AS retries_1h,
            avg(spotify_call_log.duration_ms) FILTER (WHERE spotify_call_log.created_at > (now() - '01:00:00'::interval)) AS avg_ms_1h
           FROM spotify_call_log
          WHERE spotify_call_log.app_id IS NOT NULL
          GROUP BY spotify_call_log.app_id
        ), accounts_per_app AS (
         SELECT spotify_user_tokens.app_id,
            count(*)::integer AS accounts_count
           FROM spotify_user_tokens
          WHERE spotify_user_tokens.app_id IS NOT NULL
          GROUP BY spotify_user_tokens.app_id
        ), playlists_per_app AS (
         SELECT ut.app_id,
            count(*) FILTER (WHERE mp.archived_at IS NULL)::integer AS active_playlists,
            count(*)::integer AS total_playlists
           FROM managed_playlists mp
             JOIN accounts a_1 ON a_1.id = mp.account_id
             JOIN spotify_user_tokens ut ON ut.id = a_1.spotify_user_token_id
          WHERE ut.app_id IS NOT NULL
          GROUP BY ut.app_id
        ), breaker AS (
         SELECT spotify_circuit_breaker.app_id,
            spotify_circuit_breaker.status AS circuit_breaker
           FROM spotify_circuit_breaker
        )
 SELECT a.id,
    a.name,
    a.status,
    a.lifecycle_state,
    a.purpose,
    a.created_at,
    a.development_mode,
    a.extended_quota,
    a.blocked_reason,
    a.quarantined_until,
    a.removed_from_pool_at,
    COALESCE(ac.accounts_count, 0) AS accounts_count,
    a.max_accounts,
    COALESCE(pl.active_playlists, 0) AS active_playlists,
    COALESCE(pl.total_playlists, 0) AS total_playlists,
    a.max_playlists,
    COALESCE(c.calls_5m, 0::bigint) AS calls_last_5m,
    COALESCE(c.calls_1h, 0::bigint) AS calls_last_1h,
    COALESCE(c.calls_24h, 0::bigint) AS calls_last_24h,
    COALESCE(c.calls_7d, 0::bigint) AS calls_last_7d,
    a.cap_calls_per_minute,
    a.cap_calls_per_hour,
    COALESCE(c.err_403_1h, 0::bigint) AS error_403_last_hour,
    COALESCE(c.err_429_1h, 0::bigint) AS error_429_last_hour,
    COALESCE(c.retries_1h, 0::bigint) AS retries_last_hour,
    COALESCE(c.avg_ms_1h, 0::numeric)::integer AS average_latency_ms,
    COALESCE(b.circuit_breaker, 'closed'::text) AS circuit_breaker,
    LEAST(100::numeric, GREATEST(0::numeric, 0.45 * (COALESCE(c.calls_1h, 0::bigint)::numeric / NULLIF(a.cap_calls_per_hour, 0)::numeric * 100::numeric) + 0.30 * (COALESCE(pl.active_playlists, 0)::numeric / NULLIF(a.max_playlists, 0)::numeric * 100::numeric) + 0.25 * (COALESCE(ac.accounts_count, 0)::numeric / NULLIF(a.max_accounts, 0)::numeric * 100::numeric)))::smallint AS capacity_score,
    GREATEST(0::bigint, LEAST(100::bigint, 100 - LEAST(40::bigint, COALESCE(c.err_403_1h, 0::bigint) * 2) - LEAST(30::bigint, COALESCE(c.err_429_1h, 0::bigint)) - LEAST(15::bigint, COALESCE(c.retries_1h, 0::bigint)) -
        CASE WHEN COALESCE(b.circuit_breaker, 'closed'::text) <> 'closed'::text THEN 30 ELSE 0 END -
        CASE WHEN COALESCE(c.avg_ms_1h, 0::numeric) > 1500::numeric THEN 10 ELSE 0 END))::smallint AS health_score,
    a.soft_capacity_cap,
    a.min_health_score,
    (a.lifecycle_state = 'active'::text AND a.status = 'active'::text AND (a.quarantined_until IS NULL OR a.quarantined_until <= now()) AND a.removed_from_pool_at IS NULL) AS pool_eligible
   FROM spotify_apps a
     LEFT JOIN calls c ON c.app_id = a.id
     LEFT JOIN accounts_per_app ac ON ac.app_id = a.id
     LEFT JOIN playlists_per_app pl ON pl.app_id = a.id
     LEFT JOIN breaker b ON b.app_id = a.id::text;

GRANT SELECT ON public.spotify_app_overview TO authenticated;
GRANT ALL ON public.spotify_app_overview TO service_role;

-- 3) Dropa a coluna
ALTER TABLE public.spotify_apps DROP COLUMN is_default;
