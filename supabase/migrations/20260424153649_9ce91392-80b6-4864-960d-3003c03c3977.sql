-- 🚨 Audit #11 P6: Reconcile genres counts (stale stats)
CREATE OR REPLACE FUNCTION public.reconcile_genre_counts()
RETURNS TABLE(genre_id uuid, before_playlists int, after_playlists int, before_termos int, after_termos int, before_musicas int, after_musicas int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH counts AS (
    SELECT g.id AS gid,
           g.total_playlists AS old_pl,
           g.total_termos    AS old_tm,
           g.total_musicas   AS old_ms,
           (SELECT COUNT(*)::int FROM public.search_results sr WHERE sr.genre_id = g.id AND sr.is_valid = true) AS new_pl,
           (SELECT COUNT(*)::int FROM public.search_terms st WHERE st.genre_id = g.id) AS new_tm,
           (SELECT COUNT(*)::int FROM public.search_tracks tr WHERE tr.genre_id = g.id) AS new_ms
    FROM public.genres g
  ),
  upd AS (
    UPDATE public.genres g
       SET total_playlists = c.new_pl,
           total_termos    = c.new_tm,
           total_musicas   = c.new_ms
      FROM counts c
     WHERE g.id = c.gid
       AND (g.total_playlists IS DISTINCT FROM c.new_pl
         OR g.total_termos    IS DISTINCT FROM c.new_tm
         OR g.total_musicas   IS DISTINCT FROM c.new_ms)
    RETURNING g.id
  )
  SELECT c.gid, c.old_pl, c.new_pl, c.old_tm, c.new_tm, c.old_ms, c.new_ms
    FROM counts c
   WHERE c.gid IN (SELECT id FROM upd);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_genre_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_genre_counts() TO service_role, authenticated;

-- 🚨 Audit #11 P4: Tuning autovacuum nas singletons (UPDATE-heavy, baixo volume)
ALTER TABLE public.spotify_tokens   SET (autovacuum_vacuum_scale_factor = 0.0, autovacuum_vacuum_threshold = 5);
ALTER TABLE public.system_flags     SET (autovacuum_vacuum_scale_factor = 0.0, autovacuum_vacuum_threshold = 5);
ALTER TABLE public.spotify_user_tokens SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 10);
ALTER TABLE public.playlist_templates  SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_vacuum_threshold = 50);