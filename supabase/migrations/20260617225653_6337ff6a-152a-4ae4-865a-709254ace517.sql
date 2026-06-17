-- FASE 5.D — Corrige last_import_delta e leitura atual por reference_date
-- Problema: uploads 14/06 e 15/06 vieram com window_kind='unknown'.
-- O delivery total já estava restaurado; esta migração corrige a exibição de
-- "última importação" para planilhas periódicas e a leitura atual por data de referência.
CREATE OR REPLACE FUNCTION public.fn_playlist_delivery_accumulated(p_campaign_id uuid)
RETURNS TABLE(
  playlist_id text,
  delivery_accumulated bigint,
  current_reading bigint,
  last_reading_at timestamp with time zone,
  readings_count integer,
  last_import_delta bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH canon AS MATERIALIZED (
    SELECT canonical_window_days
      FROM public.campaigns
     WHERE id = p_campaign_id
  ),
  allowed AS MATERIALIZED (
    SELECT ccp.playlist_id
      FROM public.curator_campaign_playlists ccp
     WHERE ccp.campaign_id = p_campaign_id
       AND COALESCE(ccp.excluded_from_kpis, false) = false
    UNION
    SELECT mp.spotify_playlist_id
      FROM public.campaign_eco_allocations a
      JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
     WHERE a.campaign_id = p_campaign_id
       AND mp.spotify_playlist_id IS NOT NULL
    UNION
    SELECT cpc.playlist_id
      FROM public.campaign_playlist_collections cpc
     WHERE cpc.campaign_id = p_campaign_id
       AND cpc.is_baseline = true
       AND COALESCE(cpc.excluded, false) = false
       AND cpc.playlist_id IS NOT NULL
  ),
  valid AS MATERIALIZED (
    SELECT c.playlist_id,
           c.plays_7d,
           c.is_baseline,
           c.captured_at,
           c.upload_id,
           COALESCE(u.created_at, c.created_at) AS up_created,
           COALESCE(u.reference_date, (c.captured_at AT TIME ZONE 'UTC')::date) AS up_ref_date,
           COALESCE(
             u.window_kind,
             CASE WHEN c.upload_id IS NULL THEN 'last_7d' ELSE 'unknown' END
           ) AS window_kind,
           COALESCE(u.upload_mode, CASE WHEN c.upload_id IS NULL THEN 'snapshot' ELSE 'periodic' END) AS upload_mode
      FROM public.campaign_playlist_collections c
      LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
     WHERE c.campaign_id = p_campaign_id
       AND COALESCE(c.excluded, false) = false
       AND (u.id IS NULL OR (u.quarantined_at IS NULL AND COALESCE(u.status, 'imported') <> 'superseded'))
       AND c.window_days = (SELECT canonical_window_days FROM canon)
       AND (c.is_baseline = true OR c.playlist_id IN (SELECT a2.playlist_id FROM allowed a2))
  ),
  has_baseline AS MATERIALIZED (
    SELECT v.playlist_id, BOOL_OR(v.is_baseline) AS has_bl
      FROM valid v
     GROUP BY v.playlist_id
  ),
  ordered AS MATERIALIZED (
    SELECT v.playlist_id,
           v.plays_7d,
           v.captured_at,
           v.upload_id,
           v.window_kind,
           v.upload_mode,
           hb.has_bl,
           ROW_NUMBER() OVER (
             PARTITION BY v.playlist_id
             ORDER BY v.up_ref_date, v.up_created, v.captured_at
           ) AS rn,
           LAG(v.plays_7d) OVER (
             PARTITION BY v.playlist_id
             ORDER BY v.up_ref_date, v.up_created, v.captured_at
           ) AS prev_plays
      FROM valid v
      JOIN has_baseline hb USING (playlist_id)
  ),
  with_delta AS MATERIALIZED (
    SELECT o.playlist_id,
           o.plays_7d,
           o.captured_at,
           o.upload_id,
           o.rn,
           o.prev_plays,
           o.has_bl,
           o.window_kind,
           o.upload_mode,
           CASE
             WHEN o.window_kind IN ('last_24h', 'last_day')
               THEN o.plays_7d::bigint
             WHEN o.rn = 1 AND o.has_bl
               THEN 0::bigint
             WHEN o.rn = 1 AND NOT o.has_bl
               THEN o.plays_7d::bigint
             ELSE GREATEST(0, o.plays_7d - COALESCE(o.prev_plays, o.plays_7d))::bigint
           END AS delta_pos
      FROM ordered o
  ),
  totals AS MATERIALIZED (
    SELECT w.playlist_id,
           SUM(w.delta_pos)::bigint AS delivery_accumulated,
           COUNT(*)::int AS readings_count,
           MAX(w.rn) AS max_rn
      FROM with_delta w
     GROUP BY w.playlist_id
  ),
  last_row AS MATERIALIZED (
    SELECT w.playlist_id,
           w.plays_7d::bigint AS current_reading,
           w.captured_at AS last_reading_at,
           CASE
             WHEN w.upload_id IS NOT NULL AND w.upload_mode IN ('periodic', 'baseline')
               THEN w.plays_7d::bigint
             WHEN w.window_kind IN ('last_24h', 'last_day')
               THEN w.plays_7d::bigint
             WHEN w.rn = 1 AND NOT w.has_bl
               THEN w.plays_7d::bigint
             WHEN w.prev_plays IS NULL
               THEN NULL
             ELSE GREATEST(0, w.plays_7d - w.prev_plays)::bigint
           END AS last_import_delta
      FROM with_delta w
      JOIN totals t ON t.playlist_id = w.playlist_id AND t.max_rn = w.rn
  )
  SELECT t.playlist_id,
         t.delivery_accumulated,
         lr.current_reading,
         lr.last_reading_at,
         t.readings_count,
         lr.last_import_delta
    FROM totals t
    LEFT JOIN last_row lr ON lr.playlist_id = t.playlist_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_playlist_delivery_accumulated(uuid) TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.fn_playlist_delivery_accumulated(uuid) IS
'Delivery acumulado NexEngine: baseline não entrega; upload diário conta integralmente; janela móvel conta apenas crescimento positivo contra a leitura anterior; last_import_delta em planilha periódica mostra o valor importado da última planilha mesmo quando window_kind=unknown; superseded/quarentena/excluídos ficam fora. Não usa High-Water Mark absoluto.';

CREATE OR REPLACE VIEW public.vw_campaign_playlist_growth AS
WITH valid_collections AS (
  SELECT c.id, c.campaign_id, c.playlist_id, c.playlist_url,
         c.playlist_name_at_capture, c.plays_7d, c.captured_at, c.is_baseline,
         c.first_seen_at, c.source, c.proof_screenshot_url, c.created_at,
         c.collection_run_id, c.proof_screenshot_urls, c.snapshot_run_id,
         c.upload_id, c.excluded, c.exclusion_reason,
         COALESCE(u.reference_date, (c.captured_at AT TIME ZONE 'UTC')::date) AS ref_date,
         COALESCE(u.created_at, c.created_at) AS upload_created
    FROM public.campaign_playlist_collections c
    LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
   WHERE COALESCE(c.excluded, false) = false
     AND (u.id IS NULL OR (u.quarantined_at IS NULL AND COALESCE(u.status,'imported') <> 'superseded'))
), baseline AS (
  SELECT DISTINCT ON (campaign_id, playlist_id) campaign_id, playlist_id,
         plays_7d AS baseline_plays, playlist_name_at_capture AS baseline_name,
         captured_at AS baseline_at
    FROM valid_collections WHERE is_baseline = true
   ORDER BY campaign_id, playlist_id, ref_date DESC, upload_created DESC, captured_at DESC, created_at DESC
), latest_meta AS (
  SELECT DISTINCT ON (campaign_id, playlist_id) campaign_id, playlist_id,
         playlist_name_at_capture AS current_name, playlist_url,
         plays_7d AS latest_plays, captured_at AS last_captured_at
    FROM valid_collections
   ORDER BY campaign_id, playlist_id, ref_date DESC, upload_created DESC, captured_at DESC, created_at DESC
), campaigns_with_data AS (
  SELECT DISTINCT campaign_id FROM valid_collections
), all_ids AS (
  SELECT DISTINCT campaign_id, playlist_id FROM valid_collections
), acc AS (
  SELECT c.campaign_id, f.playlist_id, f.delivery_accumulated, f.current_reading,
         f.last_reading_at, f.readings_count, f.last_import_delta
    FROM campaigns_with_data c
    CROSS JOIN LATERAL public.fn_playlist_delivery_accumulated(c.campaign_id) f
), firsts AS (
  SELECT campaign_id, playlist_id, MIN(first_seen_at) AS first_seen_at
    FROM valid_collections GROUP BY campaign_id, playlist_id
), eco AS (
  SELECT a.campaign_id, mp.spotify_playlist_id AS playlist_id
    FROM public.campaign_eco_allocations a
    JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
   WHERE mp.spotify_playlist_id IS NOT NULL
), internal_owned AS (
  SELECT DISTINCT mp.spotify_playlist_id AS playlist_id
    FROM public.managed_playlists mp WHERE mp.spotify_playlist_id IS NOT NULL
), curator_reg AS (
  SELECT DISTINCT ON (campaign_id, playlist_id) campaign_id, playlist_id, curator_id, status, excluded_from_kpis
    FROM public.curator_campaign_playlists
   ORDER BY campaign_id, playlist_id,
     (CASE status WHEN 'matched' THEN 1 WHEN 'pending_match' THEN 2 WHEN 'baseline_conflict' THEN 3 ELSE 4 END)
)
SELECT ai.campaign_id, ai.playlist_id, lm.playlist_url, lm.current_name,
       b.baseline_name, b.baseline_plays, lm.latest_plays AS current_plays,
       COALESCE(acc.delivery_accumulated, 0::bigint) AS delivery_accumulated,
       COALESCE(acc.delivery_accumulated, 0::bigint) AS delta,
       acc.last_import_delta, b.baseline_at, lm.last_captured_at, fr.first_seen_at,
       CASE
         WHEN eco.playlist_id IS NOT NULL THEN 'ecosystem'::text
         WHEN io.playlist_id IS NOT NULL THEN 'organic'::text
         WHEN cr.curator_id IS NOT NULL AND COALESCE(cr.excluded_from_kpis,false)=false THEN 'curator:'||cr.curator_id::text
         WHEN cr.curator_id IS NOT NULL AND cr.status='baseline_conflict' THEN 'curator:'||cr.curator_id::text
         ELSE 'organic'::text
       END AS attributed_to
  FROM all_ids ai
  LEFT JOIN baseline b ON b.campaign_id=ai.campaign_id AND b.playlist_id=ai.playlist_id
  LEFT JOIN latest_meta lm ON lm.campaign_id=ai.campaign_id AND lm.playlist_id=ai.playlist_id
  LEFT JOIN acc ON acc.campaign_id=ai.campaign_id AND acc.playlist_id=ai.playlist_id
  LEFT JOIN firsts fr ON fr.campaign_id=ai.campaign_id AND fr.playlist_id=ai.playlist_id
  LEFT JOIN eco ON eco.campaign_id=ai.campaign_id AND eco.playlist_id=ai.playlist_id
  LEFT JOIN internal_owned io ON io.playlist_id=ai.playlist_id
  LEFT JOIN curator_reg cr ON cr.campaign_id=ai.campaign_id AND cr.playlist_id=ai.playlist_id;

CREATE OR REPLACE FUNCTION public.get_campaign_playlist_growth(p_campaign_id uuid)
RETURNS TABLE(campaign_id uuid, playlist_id text, playlist_url text, current_name text, baseline_name text, baseline_plays integer, current_plays integer, delivery_accumulated bigint, delta bigint, last_import_delta bigint, baseline_at timestamp with time zone, last_captured_at timestamp with time zone, first_seen_at timestamp with time zone, attributed_to text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT g.campaign_id, g.playlist_id, g.playlist_url, g.current_name,
         g.baseline_name, g.baseline_plays::int, g.current_plays::int,
         g.delivery_accumulated, g.delta, g.last_import_delta,
         g.baseline_at, g.last_captured_at, g.first_seen_at, g.attributed_to
    FROM public.vw_campaign_playlist_growth g
   WHERE g.campaign_id = p_campaign_id;
$function$;

GRANT SELECT ON public.vw_campaign_playlist_growth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_campaign_playlist_growth(uuid) TO authenticated, anon, service_role;