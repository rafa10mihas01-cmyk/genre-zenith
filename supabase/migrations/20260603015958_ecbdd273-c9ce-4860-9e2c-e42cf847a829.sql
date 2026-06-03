DROP VIEW IF EXISTS public.vw_403_audit_report;
CREATE VIEW public.vw_403_audit_report WITH (security_invoker = true) AS
WITH base AS (
  SELECT *
  FROM public.spotify_call_log
  WHERE http_status = 403
    AND created_at > now() - interval '7 days'
)
SELECT 'endpoint'::text AS group_kind, endpoint AS group_key, count(*)::bigint AS errors_7d, max(created_at) AS last_seen
  FROM base GROUP BY endpoint
UNION ALL
SELECT 'function_name', COALESCE(function_name,'(unknown)'), count(*)::bigint, max(created_at) FROM base GROUP BY function_name
UNION ALL
SELECT 'playlist_id',   COALESCE(playlist_id::text,'(unknown)'), count(*)::bigint, max(created_at) FROM base WHERE playlist_id IS NOT NULL GROUP BY playlist_id
UNION ALL
SELECT 'owner_id',      owner_id, count(*)::bigint, max(created_at) FROM base WHERE owner_id IS NOT NULL GROUP BY owner_id
ORDER BY errors_7d DESC
LIMIT 80;
GRANT SELECT ON public.vw_403_audit_report TO authenticated;
GRANT SELECT ON public.vw_403_audit_report TO service_role;