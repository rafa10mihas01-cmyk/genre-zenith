
-- 1) Tabela de auditoria com snapshot PRÉ-migration
CREATE TABLE IF NOT EXISTS public._audit_pre_window_migration (
  campaign_id uuid PRIMARY KEY,
  track_name text,
  curador_eco_pre bigint,
  observed_pre bigint,
  captured_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public._audit_pre_window_migration TO authenticated;
GRANT ALL ON public._audit_pre_window_migration TO service_role;
ALTER TABLE public._audit_pre_window_migration ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team reads audit"
  ON public._audit_pre_window_migration
  FOR SELECT TO authenticated
  USING (has_team_access());

INSERT INTO public._audit_pre_window_migration (campaign_id, track_name, curador_eco_pre, observed_pre)
SELECT c.id, c.track_name,
       (public.fn_campaign_delivery_accumulated(c.id)).total_plays,
       (public.fn_campaign_delivery_accumulated(c.id)).observed_plays
  FROM public.campaigns c
 WHERE c.id IN (SELECT DISTINCT campaign_id FROM public.campaign_playlist_collections WHERE COALESCE(excluded,false)=false)
ON CONFLICT (campaign_id) DO NOTHING;

-- 2) Schema: window_days nas três tabelas
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS canonical_window_days SMALLINT NOT NULL DEFAULT 7
  CHECK (canonical_window_days IN (1, 7, 28));

ALTER TABLE public.campaign_playlist_collections
  ADD COLUMN IF NOT EXISTS window_days SMALLINT NOT NULL DEFAULT 7
  CHECK (window_days IN (1, 7, 28));

ALTER TABLE public.label_spreadsheet_uploads
  ADD COLUMN IF NOT EXISTS window_days SMALLINT NOT NULL DEFAULT 7
  CHECK (window_days IN (1, 7, 28));

-- Index pra acelerar filtro por janela canônica
CREATE INDEX IF NOT EXISTS idx_cpc_campaign_window
  ON public.campaign_playlist_collections (campaign_id, window_days, playlist_id, captured_at);

-- 3) Reescrita: fn_playlist_delivery_accumulated usa só leituras da janela canônica
CREATE OR REPLACE FUNCTION public.fn_playlist_delivery_accumulated(p_campaign_id uuid)
RETURNS TABLE(
  playlist_id text,
  delivery_accumulated bigint,
  current_reading bigint,
  last_reading_at timestamptz,
  readings_count integer,
  last_import_delta bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH canon AS (
    SELECT canonical_window_days FROM public.campaigns WHERE id = p_campaign_id
  ),
  valid AS (
    SELECT c.playlist_id,
           c.plays_7d,
           c.is_baseline,
           c.captured_at,
           COALESCE(u.created_at, c.created_at) AS up_created
      FROM public.campaign_playlist_collections c
      LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
     WHERE c.campaign_id = p_campaign_id
       AND COALESCE(c.excluded, false) = false
       AND (u.id IS NULL OR u.quarantined_at IS NULL)
       AND c.window_days = (SELECT canonical_window_days FROM canon)
  ),
  ordered AS (
    SELECT playlist_id, plays_7d, is_baseline, up_created, captured_at,
           ROW_NUMBER() OVER (PARTITION BY playlist_id ORDER BY up_created, captured_at) AS rn,
           LAG(plays_7d) OVER (PARTITION BY playlist_id ORDER BY up_created, captured_at) AS prev_plays
      FROM valid
  ),
  with_delta AS (
    SELECT playlist_id, plays_7d, captured_at, rn, prev_plays,
           CASE
             WHEN rn = 1 THEN 0::bigint
             ELSE GREATEST(0, plays_7d - COALESCE(prev_plays, plays_7d))::bigint
           END AS delta_pos
      FROM ordered
  ),
  totals AS (
    SELECT playlist_id,
           SUM(delta_pos)::bigint  AS delivery_accumulated,
           MAX(plays_7d)::bigint   AS current_reading,
           MAX(captured_at)        AS last_reading_at,
           COUNT(*)::int           AS readings_count,
           MAX(rn)                 AS max_rn
      FROM with_delta
     GROUP BY playlist_id
  ),
  last_row AS (
    SELECT w.playlist_id,
           CASE
             WHEN w.prev_plays IS NULL THEN NULL
             ELSE GREATEST(0, w.plays_7d - w.prev_plays)::bigint
           END AS last_import_delta
      FROM with_delta w
      JOIN totals t ON t.playlist_id = w.playlist_id AND t.max_rn = w.rn
  )
  SELECT t.playlist_id,
         t.delivery_accumulated,
         t.current_reading,
         t.last_reading_at,
         t.readings_count,
         l.last_import_delta
    FROM totals t
    LEFT JOIN last_row l ON l.playlist_id = t.playlist_id;
$function$;
