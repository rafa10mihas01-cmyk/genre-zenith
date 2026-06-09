
-- =========================================================
-- P1.1 — Growth Engine: delivery_accumulated como fonte única
-- =========================================================

-- 1. Função por playlist
CREATE OR REPLACE FUNCTION public.fn_playlist_delivery_accumulated(p_campaign_id uuid)
RETURNS TABLE (
  playlist_id text,
  delivery_accumulated bigint,
  current_reading bigint,
  last_reading_at timestamptz,
  readings_count int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH valid AS (
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
  ),
  ordered AS (
    SELECT playlist_id, plays_7d, is_baseline, up_created, captured_at,
           ROW_NUMBER() OVER (PARTITION BY playlist_id ORDER BY up_created, captured_at) AS rn,
           LAG(plays_7d) OVER (PARTITION BY playlist_id ORDER BY up_created, captured_at) AS prev_plays
      FROM valid
  ),
  with_delta AS (
    SELECT playlist_id, plays_7d, captured_at,
           CASE
             WHEN rn = 1 AND is_baseline THEN 0::bigint
             WHEN rn = 1 AND NOT is_baseline THEN GREATEST(0, plays_7d)::bigint
             ELSE GREATEST(0, plays_7d - COALESCE(prev_plays, plays_7d))::bigint
           END AS delta_pos
      FROM ordered
  )
  SELECT
    playlist_id,
    SUM(delta_pos)::bigint                 AS delivery_accumulated,
    MAX(plays_7d)::bigint                  AS current_reading,
    MAX(captured_at)                       AS last_reading_at,
    COUNT(*)::int                          AS readings_count
  FROM with_delta
  GROUP BY playlist_id;
$$;

-- 2. Função por curador (dentro de uma campanha)
CREATE OR REPLACE FUNCTION public.fn_curator_delivery_accumulated(p_campaign_id uuid)
RETURNS TABLE (
  curator_id uuid,
  delivery_accumulated bigint,
  playlists_count int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH per_playlist AS (
    SELECT * FROM public.fn_playlist_delivery_accumulated(p_campaign_id)
  ),
  attribution AS (
    SELECT DISTINCT ON (ccp.campaign_id, ccp.playlist_id)
           ccp.playlist_id, ccp.curator_id
      FROM public.curator_campaign_playlists ccp
     WHERE ccp.campaign_id = p_campaign_id
       AND ccp.curator_id IS NOT NULL
       AND COALESCE(ccp.excluded_from_kpis, false) = false
       AND ccp.status IN ('matched','baseline_conflict','pending_match')
     ORDER BY ccp.campaign_id, ccp.playlist_id,
              CASE ccp.status
                WHEN 'matched' THEN 1
                WHEN 'pending_match' THEN 2
                WHEN 'baseline_conflict' THEN 3
                ELSE 4
              END
  )
  SELECT a.curator_id,
         SUM(p.delivery_accumulated)::bigint AS delivery_accumulated,
         COUNT(*)::int AS playlists_count
    FROM per_playlist p
    JOIN attribution a USING (playlist_id)
   GROUP BY a.curator_id;
$$;

-- 3. Função por deal
CREATE OR REPLACE FUNCTION public.fn_deal_delivery_accumulated(p_deal_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(c.delivery_accumulated), 0)::bigint
    FROM public.curator_deals d
    JOIN public.fn_curator_delivery_accumulated(d.campaign_id) c
      ON c.curator_id = d.curator_id
   WHERE d.id = p_deal_id;
$$;

-- 4. Função por campanha (curadores + ecossistema + orgânico)
CREATE OR REPLACE FUNCTION public.fn_campaign_delivery_accumulated(p_campaign_id uuid)
RETURNS TABLE (
  curator_plays bigint,
  eco_plays bigint,
  organic_plays bigint,
  total_plays bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH per_playlist AS (
    SELECT * FROM public.fn_playlist_delivery_accumulated(p_campaign_id)
  ),
  curator_map AS (
    SELECT DISTINCT playlist_id
      FROM public.curator_campaign_playlists
     WHERE campaign_id = p_campaign_id
       AND curator_id IS NOT NULL
       AND COALESCE(excluded_from_kpis,false)=false
       AND status IN ('matched','baseline_conflict','pending_match')
  ),
  eco_map AS (
    SELECT DISTINCT mp.spotify_playlist_id AS playlist_id
      FROM public.campaign_eco_allocations a
      JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
     WHERE a.campaign_id = p_campaign_id
       AND mp.spotify_playlist_id IS NOT NULL
  ),
  curator_total AS (
    SELECT COALESCE(SUM(delivery_accumulated),0)::bigint AS v
      FROM public.fn_curator_delivery_accumulated(p_campaign_id)
  ),
  eco_total AS (
    SELECT COALESCE(SUM(latest.plays_28d),0)::bigint AS v
      FROM (
        SELECT DISTINCT ON (managed_playlist_id) plays_28d
          FROM public.campaign_eco_snapshots
         WHERE campaign_id = p_campaign_id
         ORDER BY managed_playlist_id, captured_at DESC
      ) latest
  ),
  organic_total AS (
    SELECT COALESCE(SUM(p.delivery_accumulated),0)::bigint AS v
      FROM per_playlist p
      LEFT JOIN curator_map cm ON cm.playlist_id = p.playlist_id
      LEFT JOIN eco_map em     ON em.playlist_id = p.playlist_id
     WHERE cm.playlist_id IS NULL
       AND em.playlist_id IS NULL
  )
  SELECT
    (SELECT v FROM curator_total) AS curator_plays,
    (SELECT v FROM eco_total)     AS eco_plays,
    (SELECT v FROM organic_total) AS organic_plays,
    (SELECT v FROM curator_total) + (SELECT v FROM eco_total) + (SELECT v FROM organic_total) AS total_plays;
$$;

-- 5. View atualizada — delta passa a ser ALIAS de delivery_accumulated
DROP VIEW IF EXISTS public.vw_campaign_playlist_growth;

CREATE VIEW public.vw_campaign_playlist_growth AS
WITH valid_collections AS (
  SELECT c.*
    FROM public.campaign_playlist_collections c
    LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
   WHERE COALESCE(c.excluded,false) = false
     AND (u.id IS NULL OR u.quarantined_at IS NULL)
),
baseline AS (
  SELECT DISTINCT ON (campaign_id, playlist_id)
         campaign_id, playlist_id,
         plays_7d AS baseline_plays,
         playlist_name_at_capture AS baseline_name,
         captured_at AS baseline_at
    FROM valid_collections
   WHERE is_baseline = true
   ORDER BY campaign_id, playlist_id, captured_at DESC, created_at DESC
),
latest_meta AS (
  SELECT DISTINCT ON (campaign_id, playlist_id)
         campaign_id, playlist_id,
         playlist_name_at_capture AS current_name,
         playlist_url,
         plays_7d AS latest_plays,
         captured_at AS last_captured_at
    FROM valid_collections
   ORDER BY campaign_id, playlist_id, captured_at DESC, created_at DESC
),
campaigns_with_data AS (
  SELECT DISTINCT campaign_id FROM valid_collections
),
all_ids AS (
  SELECT DISTINCT campaign_id, playlist_id FROM valid_collections
),
acc AS (
  SELECT c.campaign_id, f.*
    FROM campaigns_with_data c
    CROSS JOIN LATERAL public.fn_playlist_delivery_accumulated(c.campaign_id) f
),
firsts AS (
  SELECT campaign_id, playlist_id, MIN(first_seen_at) AS first_seen_at
    FROM valid_collections
   GROUP BY campaign_id, playlist_id
),
eco AS (
  SELECT a.campaign_id, mp.spotify_playlist_id AS playlist_id
    FROM public.campaign_eco_allocations a
    JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
   WHERE mp.spotify_playlist_id IS NOT NULL
),
internal_owned AS (
  SELECT DISTINCT mp.spotify_playlist_id AS playlist_id
    FROM public.managed_playlists mp
   WHERE mp.spotify_playlist_id IS NOT NULL
),
curator_reg AS (
  SELECT DISTINCT ON (campaign_id, playlist_id)
         campaign_id, playlist_id, curator_id, status, excluded_from_kpis
    FROM public.curator_campaign_playlists
   ORDER BY campaign_id, playlist_id,
            CASE status
              WHEN 'matched' THEN 1
              WHEN 'pending_match' THEN 2
              WHEN 'baseline_conflict' THEN 3
              ELSE 4
            END
)
SELECT
  ai.campaign_id,
  ai.playlist_id,
  lm.playlist_url,
  lm.current_name,
  b.baseline_name,
  b.baseline_plays,
  lm.latest_plays                                   AS current_plays,        -- monitoramento
  COALESCE(acc.delivery_accumulated, 0)::bigint     AS delivery_accumulated, -- métrica oficial
  COALESCE(acc.delivery_accumulated, 0)::bigint     AS delta,                -- alias (compat)
  b.baseline_at,
  lm.last_captured_at,
  fr.first_seen_at,
  CASE
    WHEN eco.playlist_id IS NOT NULL THEN 'ecosystem'::text
    WHEN io.playlist_id  IS NOT NULL THEN 'organic'::text
    WHEN cr.curator_id IS NOT NULL AND COALESCE(cr.excluded_from_kpis,false)=false
      THEN 'curator:'::text || cr.curator_id::text
    WHEN cr.curator_id IS NOT NULL AND cr.status = 'baseline_conflict'
      THEN 'curator:'::text || cr.curator_id::text
    ELSE 'organic'::text
  END AS attributed_to
FROM all_ids ai
LEFT JOIN baseline    b  ON b.campaign_id=ai.campaign_id AND b.playlist_id=ai.playlist_id
LEFT JOIN latest_meta lm ON lm.campaign_id=ai.campaign_id AND lm.playlist_id=ai.playlist_id
LEFT JOIN acc            ON acc.campaign_id=ai.campaign_id AND acc.playlist_id=ai.playlist_id
LEFT JOIN firsts      fr ON fr.campaign_id=ai.campaign_id AND fr.playlist_id=ai.playlist_id
LEFT JOIN eco            ON eco.campaign_id=ai.campaign_id AND eco.playlist_id=ai.playlist_id
LEFT JOIN internal_owned io ON io.playlist_id=ai.playlist_id
LEFT JOIN curator_reg cr ON cr.campaign_id=ai.campaign_id AND cr.playlist_id=ai.playlist_id;

GRANT SELECT ON public.vw_campaign_playlist_growth TO authenticated, anon, service_role;

-- 6. Recompute usando a nova fonte única + sincroniza deals da campanha
CREATE OR REPLACE FUNCTION public.recompute_campaign_total_delivered(p_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
BEGIN
  IF p_campaign_id IS NULL THEN RETURN; END IF;

  -- Total = curadores + ecossistema + orgânico (delivery_accumulated)
  SELECT total_plays INTO v_total
    FROM public.fn_campaign_delivery_accumulated(p_campaign_id);

  v_total := COALESCE(v_total, 0);

  -- Sincroniza cada deal da campanha com sua fatia de curador
  UPDATE public.curator_deals d
     SET reconciled_total_plays = COALESCE(c.delivery_accumulated, 0)
    FROM public.fn_curator_delivery_accumulated(p_campaign_id) c
   WHERE d.campaign_id = p_campaign_id
     AND d.curator_id = c.curator_id
     AND d.reconciled_total_plays IS DISTINCT FROM COALESCE(c.delivery_accumulated, 0);

  -- Zera deals sem entrega atribuída
  UPDATE public.curator_deals d
     SET reconciled_total_plays = 0
   WHERE d.campaign_id = p_campaign_id
     AND COALESCE(d.reconciled_total_plays, 0) <> 0
     AND NOT EXISTS (
       SELECT 1 FROM public.fn_curator_delivery_accumulated(p_campaign_id) c
        WHERE c.curator_id = d.curator_id
     );

  -- Atualiza total da campanha
  UPDATE public.campaigns
     SET total_delivered = v_total
   WHERE id = p_campaign_id
     AND total_delivered IS DISTINCT FROM v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_playlist_delivery_accumulated(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_curator_delivery_accumulated(uuid)  TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_deal_delivery_accumulated(uuid)     TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_campaign_delivery_accumulated(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_campaign_total_delivered(uuid) TO authenticated, service_role;
