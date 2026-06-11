
-- ============================================================
-- 1) Tabela de auditoria do deploy (snapshot pré/pós)
-- ============================================================
CREATE TABLE IF NOT EXISTS public._audit_post_baseline_migration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  campaign_id uuid NOT NULL,
  campaign_name text,
  origem text,
  entregue_antes bigint NOT NULL,
  entregue_depois bigint NOT NULL,
  delta_abs bigint NOT NULL,
  delta_pct numeric,
  playlists_afetadas int NOT NULL,
  per_playlist jsonb NOT NULL DEFAULT '[]'::jsonb
);

GRANT SELECT ON public._audit_post_baseline_migration TO authenticated;
GRANT ALL ON public._audit_post_baseline_migration TO service_role;

ALTER TABLE public._audit_post_baseline_migration ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_post_baseline_team_read" ON public._audit_post_baseline_migration;
CREATE POLICY "audit_post_baseline_team_read"
  ON public._audit_post_baseline_migration
  FOR SELECT TO authenticated
  USING ((SELECT has_team_access()));

-- ============================================================
-- 2) Snapshot ANTES da troca: roda lógica nova vs antiga em paralelo
--    e grava a comparação em _audit_post_baseline_migration.
-- ============================================================
WITH active AS (
  SELECT id, track_name, canonical_window_days FROM public.campaigns
),
valid AS (
  SELECT c.campaign_id, c.playlist_id, c.plays_7d, c.is_baseline, c.captured_at,
         COALESCE(u.created_at, c.created_at) AS up_created
    FROM public.campaign_playlist_collections c
    JOIN active a ON a.id = c.campaign_id
    LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
   WHERE COALESCE(c.excluded,false) = false
     AND (u.id IS NULL OR u.quarantined_at IS NULL)
     AND c.window_days = a.canonical_window_days
),
has_baseline AS (
  SELECT campaign_id, playlist_id, BOOL_OR(is_baseline) AS has_bl
  FROM valid GROUP BY 1,2
),
ordered AS (
  SELECT v.*, hb.has_bl,
         ROW_NUMBER() OVER (PARTITION BY v.campaign_id, v.playlist_id ORDER BY v.up_created, v.captured_at) AS rn,
         LAG(v.plays_7d) OVER (PARTITION BY v.campaign_id, v.playlist_id ORDER BY v.up_created, v.captured_at) AS prev
  FROM valid v JOIN has_baseline hb USING (campaign_id, playlist_id)
),
deltas AS (
  SELECT campaign_id, playlist_id, has_bl,
    SUM(CASE WHEN rn = 1 THEN 0
             ELSE GREATEST(0, plays_7d - COALESCE(prev, plays_7d)) END)::bigint AS antes,
    SUM(CASE
          WHEN rn = 1 AND has_bl THEN 0
          WHEN rn = 1 AND NOT has_bl THEN plays_7d
          ELSE GREATEST(0, plays_7d - COALESCE(prev, plays_7d))
        END)::bigint AS depois
  FROM ordered GROUP BY 1,2,3
),
attrib AS (
  SELECT d.campaign_id, d.playlist_id, d.has_bl, d.antes, d.depois,
    CASE
      WHEN eco.playlist_id IS NOT NULL THEN 'ecosystem'
      WHEN io.playlist_id IS NOT NULL THEN 'organic'
      WHEN cr.curator_id IS NOT NULL AND COALESCE(cr.excluded_from_kpis,false) = false THEN 'curator'
      WHEN cr.curator_id IS NOT NULL AND cr.status = 'baseline_conflict' THEN 'curator'
      ELSE 'organic'
    END AS origem
  FROM deltas d
  LEFT JOIN (
    SELECT DISTINCT a.campaign_id, mp.spotify_playlist_id AS playlist_id
    FROM public.campaign_eco_allocations a
    JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
    WHERE mp.spotify_playlist_id IS NOT NULL
  ) eco ON eco.campaign_id = d.campaign_id AND eco.playlist_id = d.playlist_id
  LEFT JOIN (
    SELECT DISTINCT spotify_playlist_id AS playlist_id FROM public.managed_playlists
    WHERE spotify_playlist_id IS NOT NULL
  ) io ON io.playlist_id = d.playlist_id
  LEFT JOIN LATERAL (
    SELECT curator_id, status, excluded_from_kpis FROM public.curator_campaign_playlists
    WHERE campaign_id = d.campaign_id AND playlist_id = d.playlist_id
    ORDER BY CASE status WHEN 'matched' THEN 1 WHEN 'pending_match' THEN 2 WHEN 'baseline_conflict' THEN 3 ELSE 4 END
    LIMIT 1
  ) cr ON true
)
INSERT INTO public._audit_post_baseline_migration
  (campaign_id, campaign_name, origem, entregue_antes, entregue_depois, delta_abs, delta_pct, playlists_afetadas, per_playlist)
SELECT
  at.campaign_id,
  a.track_name,
  at.origem,
  SUM(at.antes)::bigint AS entregue_antes,
  SUM(at.depois)::bigint AS entregue_depois,
  SUM(at.depois - at.antes)::bigint AS delta_abs,
  ROUND((SUM(at.depois - at.antes)::numeric / NULLIF(SUM(at.antes),0)) * 100, 4) AS delta_pct,
  COUNT(*) FILTER (WHERE at.depois <> at.antes)::int AS playlists_afetadas,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'playlist_id', at.playlist_id,
        'antes', at.antes,
        'depois', at.depois,
        'recuperado', at.depois - at.antes,
        'has_real_baseline', at.has_bl
      ) ORDER BY (at.depois - at.antes) DESC
    ) FILTER (WHERE at.depois <> at.antes),
    '[]'::jsonb
  ) AS per_playlist
FROM attrib at
JOIN active a ON a.id = at.campaign_id
GROUP BY at.campaign_id, a.track_name, at.origem;

-- ============================================================
-- 3) Reescreve fn_playlist_delivery_accumulated com a nova regra
--    (1ª leitura = entrega quando NÃO existe baseline real)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_playlist_delivery_accumulated(p_campaign_id uuid)
RETURNS TABLE(
  playlist_id text,
  delivery_accumulated bigint,
  current_reading bigint,
  last_reading_at timestamptz,
  readings_count int,
  last_import_delta bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  has_baseline AS (
    SELECT playlist_id, BOOL_OR(is_baseline) AS has_bl
      FROM valid GROUP BY playlist_id
  ),
  ordered AS (
    SELECT v.playlist_id, v.plays_7d, v.captured_at, hb.has_bl,
           ROW_NUMBER() OVER (PARTITION BY v.playlist_id ORDER BY v.up_created, v.captured_at) AS rn,
           LAG(v.plays_7d) OVER (PARTITION BY v.playlist_id ORDER BY v.up_created, v.captured_at) AS prev_plays
      FROM valid v
      JOIN has_baseline hb USING (playlist_id)
  ),
  with_delta AS (
    SELECT playlist_id, plays_7d, captured_at, rn, prev_plays, has_bl,
           CASE
             WHEN rn = 1 AND has_bl     THEN 0::bigint
             WHEN rn = 1 AND NOT has_bl THEN plays_7d::bigint
             ELSE GREATEST(0, plays_7d - COALESCE(prev_plays, plays_7d))::bigint
           END AS delta_pos
      FROM ordered
  ),
  totals AS (
    SELECT playlist_id,
           SUM(delta_pos)::bigint AS delivery_accumulated,
           MAX(plays_7d)::bigint  AS current_reading,
           MAX(captured_at)       AS last_reading_at,
           COUNT(*)::int          AS readings_count,
           MAX(rn)                AS max_rn
      FROM with_delta GROUP BY playlist_id
  ),
  last_row AS (
    SELECT w.playlist_id,
           CASE
             WHEN w.rn = 1 AND NOT w.has_bl THEN w.plays_7d::bigint
             WHEN w.prev_plays IS NULL      THEN NULL
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
         lr.last_import_delta
    FROM totals t
    LEFT JOIN last_row lr ON lr.playlist_id = t.playlist_id;
$$;

-- ============================================================
-- 4) View de origem da entrega (baseline original vs pós-baseline)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_campaign_playlist_delivery_origin
WITH (security_invoker = true)
AS
WITH canon AS (
  SELECT id AS campaign_id, canonical_window_days FROM public.campaigns
),
valid AS (
  SELECT c.campaign_id, c.playlist_id, c.is_baseline
    FROM public.campaign_playlist_collections c
    JOIN canon ON canon.campaign_id = c.campaign_id
    LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
   WHERE COALESCE(c.excluded,false) = false
     AND (u.id IS NULL OR u.quarantined_at IS NULL)
     AND c.window_days = canon.canonical_window_days
),
origin AS (
  SELECT campaign_id, playlist_id,
         BOOL_OR(is_baseline) AS has_real_baseline
    FROM valid GROUP BY campaign_id, playlist_id
)
SELECT
  g.campaign_id,
  g.playlist_id,
  g.current_name,
  g.delivery_accumulated,
  g.attributed_to,
  COALESCE(o.has_real_baseline, false) AS has_real_baseline,
  CASE
    WHEN COALESCE(o.has_real_baseline, false) THEN 'baseline_original'
    ELSE 'post_baseline'
  END AS delivery_origin
FROM public.vw_campaign_playlist_growth g
LEFT JOIN origin o
  ON o.campaign_id = g.campaign_id AND o.playlist_id = g.playlist_id;

GRANT SELECT ON public.vw_campaign_playlist_delivery_origin TO authenticated;

-- ============================================================
-- 5) Recalcula totais oficiais das campanhas (sincroniza
--    campaigns.total_delivered e curator_deals.reconciled_total_plays)
-- ============================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.campaigns LOOP
    PERFORM public.recompute_campaign_total_delivered(r.id);
  END LOOP;
END $$;
