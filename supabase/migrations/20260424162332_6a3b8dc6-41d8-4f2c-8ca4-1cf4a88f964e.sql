
CREATE OR REPLACE FUNCTION public.expire_stale_medium_templates(p_hours integer DEFAULT 72)
 RETURNS TABLE(expired_count integer, expired_ids uuid[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  WITH expired AS (
    UPDATE public.playlist_templates
    SET status = 'archived',
        quality_tier = 'archived',
        archived_at = now(),
        archived_reason = 'expired_unused',
        updated_at = now()
    WHERE quality_tier = 'medium'
      AND status IN ('pending', 'approved')
      AND spotify_playlist_id IS NULL
      AND scored_at IS NOT NULL
      AND scored_at < now() - make_interval(hours => p_hours)
    RETURNING id, genre_id
  ),
  ids_only AS (
    SELECT array_agg(id) AS a, array_agg(jsonb_build_object('id', id, 'genre_id', genre_id)) AS j
    FROM expired
  ),
  -- 📋 Audit #13 F5: registrar cada arquivamento em playlist_adjustments
  audit AS (
    INSERT INTO public.playlist_adjustments (
      template_id, genre_id, action_type, status, triggered_by,
      before, after, details
    )
    SELECT
      e.id, e.genre_id, 'expire_stale', 'success', 'cron',
      jsonb_build_object('status', 'pending|approved', 'quality_tier', 'medium'),
      jsonb_build_object('status', 'archived', 'quality_tier', 'archived'),
      jsonb_build_object('reason', 'expired_unused', 'hours', p_hours)
    FROM expired e
    RETURNING 1
  )
  SELECT a INTO v_ids FROM ids_only;

  RETURN QUERY SELECT COALESCE(array_length(v_ids, 1), 0), COALESCE(v_ids, ARRAY[]::uuid[]);
END;
$function$;
