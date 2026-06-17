-- =====================================================================
-- FASE 5.B — High-Water Mark é o modelo oficial de Delivery
-- =====================================================================
-- Definição: Delivery por playlist = GREATEST(0, MAX(plays_7d desde
-- baseline) - baseline_plays_7d). Queda da janela móvel nunca reduz nem
-- aumenta o delivery já conquistado.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_playlist_delivery_accumulated(p_campaign_id uuid)
 RETURNS TABLE(playlist_id text, delivery_accumulated bigint, current_reading bigint, last_reading_at timestamp with time zone, readings_count integer, last_import_delta bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH canon AS MATERIALIZED (
    SELECT canonical_window_days FROM public.campaigns WHERE id = p_campaign_id
  ),
  allowed AS MATERIALIZED (
    SELECT ccp.playlist_id FROM public.curator_campaign_playlists ccp
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
           c.plays_7d::bigint AS plays_7d,
           c.is_baseline,
           c.captured_at,
           COALESCE(u.created_at, c.created_at) AS up_created,
           COALESCE(u.reference_date, (c.captured_at AT TIME ZONE 'UTC')::date) AS up_ref_date
      FROM public.campaign_playlist_collections c
      LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
     WHERE c.campaign_id = p_campaign_id
       AND COALESCE(c.excluded, false) = false
       AND (u.id IS NULL OR (u.quarantined_at IS NULL AND COALESCE(u.status, 'imported') <> 'superseded'))
       AND c.window_days = (SELECT canonical_window_days FROM canon)
       AND (c.is_baseline = true OR c.playlist_id IN (SELECT a2.playlist_id FROM allowed a2))
  ),
  -- Baseline = ÚLTIMA leitura marcada como is_baseline (por playlist), ou 0 se não houver baseline marcada.
  baseline AS MATERIALIZED (
    SELECT DISTINCT ON (v.playlist_id)
           v.playlist_id,
           v.plays_7d AS baseline_plays
      FROM valid v
     WHERE v.is_baseline
     ORDER BY v.playlist_id, v.up_ref_date DESC, v.up_created DESC, v.captured_at DESC
  ),
  -- Ordenação canônica para cálculo do HWM e do incremento da última leitura.
  ordered AS MATERIALIZED (
    SELECT v.playlist_id,
           v.plays_7d,
           v.captured_at,
           v.is_baseline,
           ROW_NUMBER() OVER w AS rn,
           COUNT(*)    OVER (PARTITION BY v.playlist_id) AS readings_count,
           MAX(v.plays_7d) OVER (PARTITION BY v.playlist_id ORDER BY v.up_ref_date, v.up_created, v.captured_at
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS hwm_running,
           MAX(v.plays_7d) OVER (PARTITION BY v.playlist_id ORDER BY v.up_ref_date, v.up_created, v.captured_at
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS hwm_prev
      FROM valid v
      WINDOW w AS (PARTITION BY v.playlist_id ORDER BY v.up_ref_date, v.up_created, v.captured_at)
  ),
  agg AS (
    SELECT o.playlist_id,
           MAX(o.plays_7d)::bigint AS hwm,
           MAX(o.readings_count)::int AS readings_count,
           (SELECT o2.plays_7d FROM ordered o2
             WHERE o2.playlist_id = o.playlist_id
             ORDER BY o2.rn DESC LIMIT 1) AS latest_plays,
           (SELECT o2.captured_at FROM ordered o2
             WHERE o2.playlist_id = o.playlist_id
             ORDER BY o2.rn DESC LIMIT 1) AS last_reading_at,
           -- Incremento de HWM que a ÚLTIMA leitura aportou.
           (SELECT GREATEST(0, COALESCE(o2.plays_7d,0) - COALESCE(o2.hwm_prev, 0))
              FROM ordered o2
             WHERE o2.playlist_id = o.playlist_id
             ORDER BY o2.rn DESC LIMIT 1) AS last_import_delta
      FROM ordered o
     GROUP BY o.playlist_id
  )
  SELECT a.playlist_id,
         GREATEST(0, a.hwm - COALESCE(b.baseline_plays, 0))::bigint AS delivery_accumulated,
         a.latest_plays::bigint AS current_reading,
         a.last_reading_at,
         a.readings_count,
         a.last_import_delta::bigint
    FROM agg a
    LEFT JOIN baseline b ON b.playlist_id = a.playlist_id;
END;
$function$;

-- Recalcula caches de TODAS as campanhas para refletir o novo modelo.
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM public.campaigns LOOP
    PERFORM public.recompute_campaign_total_delivered(v_id);
  END LOOP;
END$$;