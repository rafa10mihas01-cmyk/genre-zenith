
DROP FUNCTION IF EXISTS public.get_genre_daily_target(uuid);

CREATE OR REPLACE FUNCTION public.reconcile_account_playlist_counts()
 RETURNS TABLE(spotify_user_id text, before_count integer, after_count integer, drift integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH actual AS (
    SELECT t.spotify_owner_id AS uid, COUNT(*)::int AS real_count
      FROM public.playlist_templates t
     WHERE t.status = 'created'
       AND t.spotify_playlist_id IS NOT NULL
       AND t.spotify_owner_id IS NOT NULL
     GROUP BY t.spotify_owner_id
  ),
  combined AS (
    SELECT a.spotify_user_id::text AS uid,
           a.current_playlists AS old_c,
           COALESCE(act.real_count, 0) AS new_c
      FROM public.accounts a
      LEFT JOIN actual act ON act.uid = a.spotify_user_id
     WHERE a.current_playlists <> COALESCE(act.real_count, 0)
  ),
  upd AS (
    UPDATE public.accounts a
       SET current_playlists = c.new_c,
           updated_at = now()
      FROM combined c
     WHERE a.spotify_user_id = c.uid
    RETURNING a.spotify_user_id::text AS uid
  )
  SELECT c.uid, c.old_c, c.new_c, (c.new_c - c.old_c) AS drift
    FROM combined c
   WHERE c.uid IN (SELECT uid FROM upd);
END;
$function$;

CREATE INDEX IF NOT EXISTS idx_playlist_adjustments_template_created
  ON public.playlist_adjustments(template_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_search_results_genre_valid
  ON public.search_results(genre_id)
  WHERE is_valid = true;
