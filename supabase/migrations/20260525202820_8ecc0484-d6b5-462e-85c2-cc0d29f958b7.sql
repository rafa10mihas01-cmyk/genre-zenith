
CREATE TABLE IF NOT EXISTS public.genre_capacity_matrix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id uuid NOT NULL,
  genre_name text NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 15),
  total_followers bigint NOT NULL DEFAULT 0,
  plays_per_day_x18 bigint NOT NULL DEFAULT 0,
  plays_per_day_x30 bigint NOT NULL DEFAULT 0,
  plays_per_day_x50 bigint NOT NULL DEFAULT 0,
  playlist_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (genre_id, position)
);

CREATE INDEX IF NOT EXISTS idx_genre_capacity_matrix_genre ON public.genre_capacity_matrix(genre_id);

ALTER TABLE public.genre_capacity_matrix ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read genre capacity matrix"
ON public.genre_capacity_matrix FOR SELECT
TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.refresh_genre_capacity_matrix()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pos_factors numeric[] := ARRAY[0.12, 0.10, 0.08, 0.07, 0.06, 0.05, 0.045, 0.04, 0.035, 0.03, 0.025, 0.025, 0.025, 0.025, 0.025];
  affected int;
BEGIN
  WITH agg AS (
    SELECT
      mp.genre_id,
      SUM(GREATEST(COALESCE(mp.followers, 0), 0))::bigint AS total_followers,
      COUNT(*)::int AS playlist_count
    FROM public.managed_playlists mp
    WHERE mp.archived_at IS NULL AND mp.genre_id IS NOT NULL
    GROUP BY mp.genre_id
  ),
  rows AS (
    SELECT
      agg.genre_id,
      g.nome AS genre_name,
      p.pos AS position,
      agg.total_followers,
      ROUND(agg.total_followers::numeric * (18.0/30.0) * pos_factors[p.pos])::bigint AS plays_x18,
      ROUND(agg.total_followers::numeric * 1.0       * pos_factors[p.pos])::bigint AS plays_x30,
      ROUND(agg.total_followers::numeric * (50.0/30.0) * pos_factors[p.pos])::bigint AS plays_x50,
      agg.playlist_count
    FROM agg
    JOIN public.genres g ON g.id = agg.genre_id
    CROSS JOIN generate_series(1, 15) AS p(pos)
  ),
  upsert AS (
    INSERT INTO public.genre_capacity_matrix
      (genre_id, genre_name, position, total_followers, plays_per_day_x18, plays_per_day_x30, plays_per_day_x50, playlist_count, updated_at)
    SELECT genre_id, genre_name, position, total_followers, plays_x18, plays_x30, plays_x50, playlist_count, now()
    FROM rows
    ON CONFLICT (genre_id, position) DO UPDATE SET
      genre_name = EXCLUDED.genre_name,
      total_followers = EXCLUDED.total_followers,
      plays_per_day_x18 = EXCLUDED.plays_per_day_x18,
      plays_per_day_x30 = EXCLUDED.plays_per_day_x30,
      plays_per_day_x50 = EXCLUDED.plays_per_day_x50,
      playlist_count = EXCLUDED.playlist_count,
      updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO affected FROM upsert;

  DELETE FROM public.genre_capacity_matrix
  WHERE genre_id NOT IN (
    SELECT DISTINCT genre_id FROM public.managed_playlists
    WHERE archived_at IS NULL AND genre_id IS NOT NULL
  );

  RETURN jsonb_build_object('rows_upserted', affected, 'refreshed_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_genre_capacity_matrix() TO authenticated, service_role;
