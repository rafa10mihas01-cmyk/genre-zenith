
DROP FUNCTION IF EXISTS public.fn_campaign_delivery_accumulated(uuid) CASCADE;

CREATE FUNCTION public.fn_campaign_delivery_accumulated(p_campaign_id uuid)
 RETURNS TABLE(curator_plays bigint, eco_plays bigint, organic_plays bigint, total_plays bigint, observed_plays bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  classified AS (
    SELECT
      p.playlist_id,
      p.delivery_accumulated,
      CASE
        WHEN cm.playlist_id IS NOT NULL THEN 'curator'
        WHEN em.playlist_id IS NOT NULL THEN 'eco'
        ELSE 'organic'
      END AS bucket
    FROM per_playlist p
    LEFT JOIN curator_map cm ON cm.playlist_id = p.playlist_id
    LEFT JOIN eco_map     em ON em.playlist_id = p.playlist_id
  )
  SELECT
    COALESCE(SUM(delivery_accumulated) FILTER (WHERE bucket='curator'), 0)::bigint AS curator_plays,
    COALESCE(SUM(delivery_accumulated) FILTER (WHERE bucket='eco'),     0)::bigint AS eco_plays,
    COALESCE(SUM(delivery_accumulated) FILTER (WHERE bucket='organic'), 0)::bigint AS organic_plays,
    COALESCE(SUM(delivery_accumulated) FILTER (WHERE bucket IN ('curator','eco')), 0)::bigint AS total_plays,
    COALESCE(SUM(delivery_accumulated), 0)::bigint AS observed_plays
  FROM classified;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_campaign_delivery_accumulated(uuid) TO authenticated, anon, service_role;

-- Recria recompute_campaign_total_delivered (foi removido pelo CASCADE).
CREATE OR REPLACE FUNCTION public.recompute_campaign_total_delivered(p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint;
BEGIN
  IF p_campaign_id IS NULL THEN RETURN; END IF;

  -- Total "Entregue" = curador + ecossistema (atribuído). Orgânico fora.
  SELECT total_plays INTO v_total
    FROM public.fn_campaign_delivery_accumulated(p_campaign_id);

  v_total := COALESCE(v_total, 0);

  UPDATE public.curator_deals d
     SET reconciled_total_plays = COALESCE(c.delivery_accumulated, 0)
    FROM public.fn_curator_delivery_accumulated(p_campaign_id) c
   WHERE d.campaign_id = p_campaign_id
     AND d.curator_id = c.curator_id
     AND d.reconciled_total_plays IS DISTINCT FROM COALESCE(c.delivery_accumulated, 0);

  UPDATE public.curator_deals d
     SET reconciled_total_plays = 0
   WHERE d.campaign_id = p_campaign_id
     AND COALESCE(d.reconciled_total_plays, 0) <> 0
     AND NOT EXISTS (
       SELECT 1 FROM public.fn_curator_delivery_accumulated(p_campaign_id) c
        WHERE c.curator_id = d.curator_id
     );

  UPDATE public.campaigns
     SET total_delivered = v_total
   WHERE id = p_campaign_id
     AND total_delivered IS DISTINCT FROM v_total;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.recompute_campaign_total_delivered(uuid) TO authenticated, service_role;

-- Reescreve total_delivered de TODAS as campanhas com o novo conceito (atribuído).
UPDATE public.campaigns c
   SET total_delivered = COALESCE(f.total_plays, 0)
  FROM public.campaigns c2
  CROSS JOIN LATERAL public.fn_campaign_delivery_accumulated(c2.id) f
 WHERE c2.id = c.id
   AND c.total_delivered IS DISTINCT FROM COALESCE(f.total_plays, 0);
