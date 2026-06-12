
-- Onda 2 (sombra) — View agregando ownership por curador a partir de curator_playlists
CREATE OR REPLACE VIEW public.v_curator_library AS
SELECT
  cd.curator_id,
  cd.user_id,
  cp.spotify_playlist_id,
  -- nome mais recente vence (último insert do par curador+playlist)
  (ARRAY_AGG(cp.playlist_name ORDER BY cp.added_at DESC))[1]      AS playlist_name,
  (ARRAY_AGG(cp.spotify_url ORDER BY cp.added_at DESC))[1]        AS spotify_url,
  (ARRAY_AGG(cp.image_url ORDER BY cp.added_at DESC))[1]          AS image_url,
  (ARRAY_AGG(cp.spotify_owner_id ORDER BY cp.added_at DESC))[1]   AS spotify_owner_id,
  (ARRAY_AGG(cp.spotify_owner_name ORDER BY cp.added_at DESC))[1] AS spotify_owner_name,
  MAX(cp.followers)                                               AS followers,
  COUNT(DISTINCT cp.deal_id)                                      AS times_used,
  MAX(cp.added_at)                                                AS last_used_at,
  MIN(cp.added_at)                                                AS first_seen_at,
  BOOL_OR(cp.promoted_to_ecosystem_at IS NOT NULL)                AS is_ecosystem,
  BOOL_OR(cp.spotify_dead)                                        AS spotify_dead,
  SUM(cp.streams_7d)::bigint                                      AS streams_7d_total,
  SUM(cp.streams_total)::bigint                                   AS streams_lifetime_total
FROM public.curator_playlists cp
JOIN public.curator_deals cd ON cd.id = cp.deal_id
WHERE cp.spotify_playlist_id IS NOT NULL
GROUP BY cd.curator_id, cd.user_id, cp.spotify_playlist_id;

GRANT SELECT ON public.v_curator_library TO authenticated, service_role;
