-- =====================================================================
-- Catalog Gateway CC — Painel de Saúde (Fase 17-B, pré-17-B.6)
-- ---------------------------------------------------------------------
-- Read-only. Não altera tabelas, não cria objetos.
-- Executar inteiro num único `psql -f` (ou colar no SQL editor).
-- Cada bloco é uma query independente; rode-os em sequência.
--
-- Janela padrão: últimas 24h. Para ajustar, troque INTERVAL '24 hours'.
-- Filtro do gateway: meta->>'source' IN ('gateway-cc','gateway-cache').
-- =====================================================================


-- =====================================================================
-- 1) SAÚDE POR WORKER (últimas 24h)
-- =====================================================================
WITH base AS (
  SELECT
    function_name,
    http_status,
    status,
    duration_ms,
    created_at,
    meta->>'source' AS source
  FROM public.spotify_call_log
  WHERE created_at >= now() - INTERVAL '24 hours'
    AND meta->>'source' IN ('gateway-cc','gateway-cache')
)
SELECT
  function_name                                                                 AS worker,
  COUNT(*)                                                                      AS total_calls,
  COUNT(*) FILTER (WHERE http_status = 200)                                     AS ok_200,
  COUNT(*) FILTER (WHERE http_status = 401)                                     AS http_401,
  COUNT(*) FILTER (WHERE http_status = 403)                                     AS http_403,
  COUNT(*) FILTER (WHERE http_status = 429)                                     AS http_429,
  COUNT(*) FILTER (WHERE http_status BETWEEN 500 AND 599)                       AS http_5xx,
  ROUND(100.0 * COUNT(*) FILTER (WHERE http_status = 200) / NULLIF(COUNT(*),0), 2)
                                                                                AS success_pct,
  ROUND(AVG(duration_ms)::numeric, 1)                                           AS avg_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)                     AS p95_ms,
  MAX(created_at)                                                               AS last_seen,
  STRING_AGG(DISTINCT source, ',' ORDER BY source)                              AS sources
FROM base
GROUP BY function_name
ORDER BY total_calls DESC;


-- =====================================================================
-- 2) SAÚDE DO GATEWAY (chamadas/cache/endpoint/pool)
-- =====================================================================

-- 2a) Por source (gateway-cc vs gateway-cache vs gateway-oauth)
WITH base AS (
  SELECT meta->>'source' AS source, http_status, duration_ms
  FROM public.spotify_call_log
  WHERE created_at >= now() - INTERVAL '24 hours'
    AND meta->>'source' LIKE 'gateway-%'
)
SELECT
  source,
  COUNT(*)                                                          AS calls,
  COUNT(*) FILTER (WHERE http_status = 200)                         AS ok_200,
  ROUND(100.0 * COUNT(*) FILTER (WHERE http_status = 200) / NULLIF(COUNT(*),0), 2) AS ok_pct,
  ROUND(AVG(duration_ms)::numeric, 1)                               AS avg_ms
FROM base
GROUP BY source
ORDER BY calls DESC;

-- 2b) Top endpoints (apenas gateway-cc + gateway-cache)
WITH base AS (
  SELECT endpoint, http_status, duration_ms, meta->>'source' AS source
  FROM public.spotify_call_log
  WHERE created_at >= now() - INTERVAL '24 hours'
    AND meta->>'source' IN ('gateway-cc','gateway-cache')
)
SELECT
  endpoint,
  COUNT(*)                                                          AS calls,
  COUNT(*) FILTER (WHERE http_status = 200)                         AS ok_200,
  COUNT(*) FILTER (WHERE http_status = 403)                         AS http_403,
  COUNT(*) FILTER (WHERE http_status = 429)                         AS http_429,
  COUNT(*) FILTER (WHERE http_status BETWEEN 500 AND 599)           AS http_5xx,
  ROUND(100.0 * COUNT(*) FILTER (WHERE http_status = 200) / NULLIF(COUNT(*),0), 2) AS ok_pct,
  ROUND(AVG(duration_ms)::numeric, 1)                               AS avg_ms
FROM base
GROUP BY endpoint
ORDER BY calls DESC
LIMIT 30;

-- 2c) Cache hit rate (cache vs CC ao vivo)
SELECT
  COUNT(*) FILTER (WHERE meta->>'source' = 'gateway-cache')         AS cache_hits,
  COUNT(*) FILTER (WHERE meta->>'source' = 'gateway-cc')            AS cc_calls,
  ROUND(100.0 * COUNT(*) FILTER (WHERE meta->>'source' = 'gateway-cache')
        / NULLIF(COUNT(*) FILTER (WHERE meta->>'source' IN ('gateway-cache','gateway-cc')), 0), 2)
                                                                    AS cache_hit_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE meta->>'source' = 'gateway-cc')
        / NULLIF(COUNT(*) FILTER (WHERE meta->>'source' IN ('gateway-cache','gateway-cc')), 0), 2)
                                                                    AS cache_miss_pct
FROM public.spotify_call_log
WHERE created_at >= now() - INTERVAL '24 hours';

-- 2d) Distribuição por pool (NexEngine 05/10).
--     NOTA: ccFetch atual NÃO grava app_name/app_id (não há identificação
--     da App escolhida no log do gateway). A coluna existe mas fica NULL
--     para chamadas gateway-cc. Esta query mostra o que houver — se vier
--     tudo NULL, é esperado pela implementação atual.
SELECT
  COALESCE(app_name, '(unknown — gateway-cc não loga app)')         AS app,
  COUNT(*)                                                          AS calls
FROM public.spotify_call_log
WHERE created_at >= now() - INTERVAL '24 hours'
  AND meta->>'source' = 'gateway-cc'
GROUP BY 1
ORDER BY calls DESC;


-- =====================================================================
-- 3) CIRCUIT BREAKER
-- ---------------------------------------------------------------------
-- O breaker do Catalog Gateway (gatewayGetTracksBatch/ArtistsBatch)
-- vive em MEMÓRIA dentro de cada instância da edge function — não
-- persiste em tabela. Logo, esta seção mostra APENAS o breaker antigo
-- do balanceador OAuth (spotify_circuit_breaker / *_log), que continua
-- aplicável a workers de escrita.
--
-- Para o breaker novo do Gateway CC:
--   Circuit breaker metrics (gateway-cc, in-memory): NOT AVAILABLE
-- =====================================================================
SELECT 'gateway-cc in-memory breaker' AS scope,
       'NOT AVAILABLE (não persiste em tabela; ver logs da edge function)' AS note;

-- Histórico do breaker OAuth (últimas 24h)
SELECT
  opened_at,
  app_id,
  source_function                  AS worker,
  caused_by                        AS reason,
  retry_after_sec,
  blocked_until,
  EXTRACT(EPOCH FROM (blocked_until - opened_at))::int AS open_duration_sec,
  context
FROM public.spotify_circuit_breaker_log
WHERE opened_at >= now() - INTERVAL '24 hours'
ORDER BY opened_at DESC;

-- Estado atual do breaker OAuth
SELECT app_id, status, blocked_until, retry_after_sec, last_429_at, context, updated_at
FROM public.spotify_circuit_breaker
ORDER BY updated_at DESC;


-- =====================================================================
-- 4) CRONS CRÍTICOS (últimas 24h)
-- =====================================================================
WITH critical AS (
  SELECT unnest(ARRAY[
    'process-catalog-placements',
    'revalidate-deliveries',
    'sync-spotify-editorial-charts',
    'spotify-enrichment-worker',
    'enrich-client-spotify',
    'enrich-curator-playlists-spotify',
    'enrich-playlist-covers'
  ]) AS cron_name
),
last_runs AS (
  SELECT DISTINCT ON (cron_name)
    cron_name, started_at, finished_at, duration_ms, success,
    error_message, payload
  FROM public.cron_run_log
  WHERE started_at >= now() - INTERVAL '24 hours'
  ORDER BY cron_name, started_at DESC
),
agg AS (
  SELECT
    cron_name,
    COUNT(*)                                       AS runs_24h,
    COUNT(*) FILTER (WHERE success)                AS ok_runs,
    COUNT(*) FILTER (WHERE NOT success)            AS failed_runs
  FROM public.cron_run_log
  WHERE started_at >= now() - INTERVAL '24 hours'
  GROUP BY cron_name
)
SELECT
  c.cron_name,
  lr.started_at                                    AS last_started_at,
  lr.duration_ms                                   AS last_duration_ms,
  lr.success                                       AS last_success,
  lr.error_message                                 AS last_error,
  (lr.payload->>'processed')::int                  AS processed,
  (lr.payload->>'errors')::int                     AS errors,
  COALESCE(a.runs_24h, 0)                          AS runs_24h,
  COALESCE(a.ok_runs, 0)                           AS ok_runs,
  COALESCE(a.failed_runs, 0)                       AS failed_runs
FROM critical c
LEFT JOIN last_runs lr USING (cron_name)
LEFT JOIN agg       a  USING (cron_name)
ORDER BY c.cron_name;


-- =====================================================================
-- 5) ALERTAS
-- =====================================================================

-- 5a) Contadores agregados
WITH base AS (
  SELECT http_status, status, error, function_name, endpoint
  FROM public.spotify_call_log
  WHERE created_at >= now() - INTERVAL '24 hours'
    AND meta->>'source' IN ('gateway-cc','gateway-cache')
)
SELECT
  COUNT(*) FILTER (WHERE error ILIKE '%invalid_client%')           AS invalid_client,
  COUNT(*) FILTER (WHERE http_status = 401)                        AS http_401,
  COUNT(*) FILTER (WHERE http_status = 403)                        AS http_403,
  COUNT(*) FILTER (WHERE http_status = 429)                        AS http_429,
  COUNT(*) FILTER (WHERE http_status BETWEEN 500 AND 599)          AS http_5xx
FROM base;

-- 5b) Workers SEM execução nas últimas 24h (estavam ativos nos 7d anteriores)
WITH active_7d AS (
  SELECT DISTINCT function_name
  FROM public.spotify_call_log
  WHERE created_at >= now() - INTERVAL '7 days'
    AND created_at <  now() - INTERVAL '24 hours'
    AND meta->>'source' IN ('gateway-cc','gateway-cache')
),
seen_24h AS (
  SELECT DISTINCT function_name
  FROM public.spotify_call_log
  WHERE created_at >= now() - INTERVAL '24 hours'
    AND meta->>'source' IN ('gateway-cc','gateway-cache')
)
SELECT a.function_name AS silent_worker
FROM active_7d a
LEFT JOIN seen_24h s USING (function_name)
WHERE s.function_name IS NULL
ORDER BY 1;

-- 5c) Endpoints com taxa de erro >2%
WITH base AS (
  SELECT endpoint, http_status
  FROM public.spotify_call_log
  WHERE created_at >= now() - INTERVAL '24 hours'
    AND meta->>'source' IN ('gateway-cc','gateway-cache')
)
SELECT
  endpoint,
  COUNT(*)                                                            AS calls,
  COUNT(*) FILTER (WHERE http_status >= 400 OR http_status IS NULL)   AS errors,
  ROUND(100.0 * COUNT(*) FILTER (WHERE http_status >= 400 OR http_status IS NULL)
        / NULLIF(COUNT(*),0), 2)                                      AS error_pct
FROM base
GROUP BY endpoint
HAVING COUNT(*) >= 20
   AND 100.0 * COUNT(*) FILTER (WHERE http_status >= 400 OR http_status IS NULL)
       / NULLIF(COUNT(*),0) > 2
ORDER BY error_pct DESC;


-- =====================================================================
-- 6) RESUMO EXECUTIVO + STATUS
-- =====================================================================
WITH base AS (
  SELECT http_status, duration_ms, error, function_name
  FROM public.spotify_call_log
  WHERE created_at >= now() - INTERVAL '24 hours'
    AND meta->>'source' IN ('gateway-cc','gateway-cache')
),
totals AS (
  SELECT
    COUNT(*)                                                       AS total_calls,
    COUNT(*) FILTER (WHERE http_status = 200)                      AS ok_200,
    ROUND(100.0 * COUNT(*) FILTER (WHERE http_status = 200)
          / NULLIF(COUNT(*),0), 2)                                 AS success_pct,
    ROUND(AVG(duration_ms)::numeric, 1)                            AS avg_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)      AS p95_ms,
    COUNT(*) FILTER (WHERE http_status = 401)                      AS http_401,
    COUNT(*) FILTER (WHERE http_status = 403)                      AS http_403,
    COUNT(*) FILTER (WHERE http_status = 429)                      AS http_429,
    COUNT(*) FILTER (WHERE http_status BETWEEN 500 AND 599)        AS http_5xx,
    COUNT(*) FILTER (WHERE error ILIKE '%invalid_client%')         AS invalid_client,
    ROUND(100.0 * COUNT(*) FILTER (WHERE http_status = 429)
          / NULLIF(COUNT(*),0), 3)                                 AS pct_429
  FROM base
),
cron_fail AS (
  SELECT COUNT(*) AS failed_critical_crons
  FROM public.cron_run_log
  WHERE started_at >= now() - INTERVAL '24 hours'
    AND success = false
    AND cron_name IN (
      'process-catalog-placements',
      'revalidate-deliveries',
      'sync-spotify-editorial-charts',
      'spotify-enrichment-worker',
      'enrich-client-spotify',
      'enrich-curator-playlists-spotify',
      'enrich-playlist-covers'
    )
),
verdict AS (
  SELECT
    t.*,
    cf.failed_critical_crons,
    CASE
      WHEN t.total_calls = 0
        THEN 'YELLOW: nenhuma chamada gateway-cc/cache nas últimas 24h'
      WHEN t.invalid_client = 0
       AND t.http_401 = 0
       AND t.http_403 = 0
       AND t.success_pct >= 99
       AND t.pct_429 < 0.5
       AND cf.failed_critical_crons = 0
        THEN 'GREEN'
      WHEN t.invalid_client > 0
        OR t.http_401 > 0
        OR t.success_pct < 95
        OR cf.failed_critical_crons > 0
        THEN 'RED'
      ELSE 'YELLOW'
    END AS status,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN t.success_pct < 99            THEN 'success_pct<99 ('||t.success_pct||'%)'                 END,
      CASE WHEN t.invalid_client > 0          THEN 'invalid_client='||t.invalid_client                     END,
      CASE WHEN t.http_401 > 0                THEN 'http_401='||t.http_401                                 END,
      CASE WHEN t.http_403 > 0                THEN 'http_403='||t.http_403                                 END,
      CASE WHEN t.pct_429 >= 0.5              THEN 'pct_429='||t.pct_429||'%'                              END,
      CASE WHEN t.http_5xx > 0                THEN 'http_5xx='||t.http_5xx                                 END,
      CASE WHEN cf.failed_critical_crons > 0  THEN 'failed_critical_crons='||cf.failed_critical_crons      END
    ], NULL) AS failed_criteria
  FROM totals t CROSS JOIN cron_fail cf
)
SELECT
  total_calls,
  success_pct,
  avg_ms,
  p95_ms,
  http_429,
  http_403,
  http_5xx,
  invalid_client,
  failed_critical_crons,
  status,
  failed_criteria
FROM verdict;
