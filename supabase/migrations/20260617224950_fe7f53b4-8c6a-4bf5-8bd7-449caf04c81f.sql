-- FASE 5.C — Corrige regressão do High-Water Mark absoluto
-- Regra oficial: delivery acumulado por playlist a partir da baseline.
-- - Uploads diários (last_24h/last_day) representam entrega do dia e entram integralmente.
-- - Leituras de janela móvel entram somente pelo crescimento positivo contra a leitura anterior.
-- - Baseline não gera entrega.
-- - Uploads superseded/quarentenados e snapshots excluídos nunca participam.
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
           COALESCE(u.created_at, c.created_at) AS up_created,
           COALESCE(u.reference_date, (c.captured_at AT TIME ZONE 'UTC')::date) AS up_ref_date,
           COALESCE(
             u.window_kind,
             CASE WHEN c.upload_id IS NULL THEN 'last_7d' ELSE 'unknown' END
           ) AS window_kind
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
           v.window_kind,
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
           o.rn,
           o.prev_plays,
           o.has_bl,
           o.window_kind,
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
           MAX(w.plays_7d)::bigint AS current_reading,
           MAX(w.captured_at) AS last_reading_at,
           COUNT(*)::int AS readings_count,
           MAX(w.rn) AS max_rn
      FROM with_delta w
     GROUP BY w.playlist_id
  ),
  last_row AS MATERIALIZED (
    SELECT w.playlist_id,
           CASE
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
         t.current_reading,
         t.last_reading_at,
         t.readings_count,
         lr.last_import_delta
    FROM totals t
    LEFT JOIN last_row lr ON lr.playlist_id = t.playlist_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_playlist_delivery_accumulated(uuid) TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.fn_playlist_delivery_accumulated(uuid) IS
'Delivery acumulado NexEngine: baseline não entrega; upload diário conta integralmente; janela móvel conta apenas crescimento positivo contra a leitura anterior; superseded/quarentena/excluídos ficam fora. Não usa High-Water Mark absoluto.';