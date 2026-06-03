-- ============================================================================
-- FASE 1 — EDITORIAL BLOCKLIST
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.spotify_editorial_blocklist (
  spotify_user_id text PRIMARY KEY,
  display_name    text,
  reason          text NOT NULL DEFAULT 'editorial_403',
  created_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.spotify_editorial_blocklist TO authenticated;
GRANT ALL    ON public.spotify_editorial_blocklist TO service_role;

ALTER TABLE public.spotify_editorial_blocklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage editorial_blocklist"
  ON public.spotify_editorial_blocklist
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "team read editorial_blocklist"
  ON public.spotify_editorial_blocklist
  FOR SELECT
  TO authenticated
  USING (true);

-- Seed conhecidos (idempotente)
INSERT INTO public.spotify_editorial_blocklist (spotify_user_id, display_name, reason) VALUES
  ('spotify',         'Spotify',                'editorial_official'),
  ('spotifybrasil',   'Spotify Brasil',         'editorial_official'),
  ('filtr.br',        'Filtr Brasil (Sony)',    'editorial_label'),
  ('somlivre',        'Som Livre',              'editorial_label'),
  ('digster_brasil',  'Digster Brasil (UMG)',   'editorial_label'),
  ('digster.brasil',  'Digster Brasil (alt)',   'editorial_label'),
  ('12186310692',     'UMG editorial profile',  'editorial_label'),
  ('topsify.brasil',  'Topsify Brasil',         'editorial_label'),
  ('warnermusicbr',   'Warner Music Brasil',    'editorial_label'),
  ('sonymusicbrasil', 'Sony Music Brasil',      'editorial_label')
ON CONFLICT (spotify_user_id) DO NOTHING;

-- ============================================================================
-- FASE 2 — DIAGNOSE BLOCKED (managed_playlists)
-- ============================================================================
ALTER TABLE public.managed_playlists
  ADD COLUMN IF NOT EXISTS diagnose_blocked        boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS diagnose_blocked_at     timestamptz,
  ADD COLUMN IF NOT EXISTS diagnose_blocked_reason text,
  ADD COLUMN IF NOT EXISTS diagnose_403_streak     integer      NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_managed_playlists_diagnose_blocked
  ON public.managed_playlists (diagnose_blocked)
  WHERE diagnose_blocked = true;

-- Atualiza RPCs de tier para ignorar playlists diagnose_blocked
CREATE OR REPLACE FUNCTION public.sync_tier_hot_ids(p_limit integer, p_cutoff timestamptz)
  RETURNS TABLE(id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT mp.id
  FROM managed_playlists mp
  WHERE mp.archived_at IS NULL
    AND mp.diagnose_blocked IS NOT TRUE
    AND EXISTS (
      SELECT 1 FROM campaign_eco_allocations a
      JOIN campaigns c ON c.id = a.campaign_id
      WHERE a.managed_playlist_id = mp.id AND c.status IN ('active','planning')
    )
  ORDER BY COALESCE(mp.last_metrics_at,'epoch'::timestamptz) ASC
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.sync_tier_warm_ids(p_limit integer, p_cutoff_imported timestamptz, p_cutoff_metrics timestamptz, p_cutoff_alloc timestamptz)
  RETURNS TABLE(id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT mp.id
  FROM managed_playlists mp
  WHERE mp.archived_at IS NULL
    AND mp.diagnose_blocked IS NOT TRUE
    AND (
      COALESCE(mp.imported_at,'epoch'::timestamptz) > p_cutoff_imported
      OR COALESCE(mp.last_metrics_at,'epoch'::timestamptz) > p_cutoff_metrics
      OR EXISTS (
        SELECT 1 FROM campaign_eco_allocations a
        WHERE a.managed_playlist_id = mp.id AND a.created_at > p_cutoff_alloc
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM campaign_eco_allocations a
      JOIN campaigns c ON c.id = a.campaign_id
      WHERE a.managed_playlist_id = mp.id AND c.status IN ('active','planning')
    )
  ORDER BY COALESCE(mp.last_metrics_at,'epoch'::timestamptz) ASC
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.sync_tier_cold_ids(p_limit integer, p_cutoff_imported timestamptz, p_cutoff_metrics timestamptz, p_cutoff_alloc timestamptz)
  RETURNS TABLE(id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT mp.id
  FROM managed_playlists mp
  WHERE mp.archived_at IS NULL
    AND mp.diagnose_blocked IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1 FROM campaign_eco_allocations a
      LEFT JOIN campaigns c ON c.id = a.campaign_id
      WHERE a.managed_playlist_id = mp.id
        AND (c.status IN ('active','planning') OR a.created_at > p_cutoff_alloc)
    )
    AND NOT (COALESCE(mp.imported_at,'epoch'::timestamptz) > p_cutoff_imported OR COALESCE(mp.last_metrics_at,'epoch'::timestamptz) > p_cutoff_metrics)
  ORDER BY COALESCE(mp.last_metrics_at,'epoch'::timestamptz) ASC NULLS FIRST
  LIMIT p_limit;
$function$;

-- ============================================================================
-- FASE 3 — INSTRUMENTAÇÃO (spotify_call_log)
-- ============================================================================
ALTER TABLE public.spotify_call_log
  ADD COLUMN IF NOT EXISTS playlist_id      uuid,
  ADD COLUMN IF NOT EXISTS owner_id         text,
  ADD COLUMN IF NOT EXISTS spotify_user_id  text,
  ADD COLUMN IF NOT EXISTS error_body       text;

CREATE INDEX IF NOT EXISTS idx_spotify_call_log_playlist
  ON public.spotify_call_log (playlist_id, created_at DESC)
  WHERE playlist_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spotify_call_log_owner
  ON public.spotify_call_log (owner_id, created_at DESC)
  WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spotify_call_log_http_status
  ON public.spotify_call_log (http_status, created_at DESC)
  WHERE http_status >= 400;

-- ============================================================================
-- FASE 4 — AUDITORIA AUTOMÁTICA (view 403_audit_report)
-- ============================================================================
CREATE OR REPLACE VIEW public.vw_403_audit_report AS
WITH base AS (
  SELECT *
  FROM public.spotify_call_log
  WHERE http_status = 403
    AND created_at > now() - interval '7 days'
)
SELECT
  'endpoint'::text  AS group_kind,  endpoint        AS group_key,  count(*)::bigint AS errors_7d,  max(created_at) AS last_seen
  FROM base GROUP BY endpoint
UNION ALL
SELECT 'function_name',  COALESCE(function_name,'(unknown)'), count(*)::bigint, max(created_at)
  FROM base GROUP BY function_name
UNION ALL
SELECT 'playlist_id',    COALESCE(playlist_id::text,'(unknown)'), count(*)::bigint, max(created_at)
  FROM base WHERE playlist_id IS NOT NULL GROUP BY playlist_id
UNION ALL
SELECT 'owner_id',       owner_id, count(*)::bigint, max(created_at)
  FROM base WHERE owner_id IS NOT NULL GROUP BY owner_id
ORDER BY errors_7d DESC
LIMIT 80;

GRANT SELECT ON public.vw_403_audit_report TO authenticated;
GRANT SELECT ON public.vw_403_audit_report TO service_role;