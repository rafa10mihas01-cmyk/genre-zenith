-- Phase 2.2 — Niche Reference Map (read-only output tables, fixed numeric casts)

CREATE TABLE IF NOT EXISTS public.genre_reference_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  notes jsonb DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE ON public.genre_reference_runs TO authenticated;
GRANT ALL ON public.genre_reference_runs TO service_role;
ALTER TABLE public.genre_reference_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "genre_ref_runs_admin" ON public.genre_reference_runs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.genre_reference_artists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.genre_reference_runs(id) ON DELETE CASCADE,
  genre_id uuid NOT NULL,
  genre_name text NOT NULL,
  artist_norm text NOT NULL,
  artist_name text NOT NULL,
  playlists_in_genre integer NOT NULL DEFAULT 0,
  track_instances_in_genre integer NOT NULL DEFAULT 0,
  total_instances_all_genres integer NOT NULL DEFAULT 0,
  genres_present integer NOT NULL DEFAULT 0,
  purity_pct numeric NOT NULL DEFAULT 0,
  authority_score numeric NOT NULL DEFAULT 0,
  rank_in_genre integer,
  UNIQUE (run_id, genre_id, artist_norm)
);
CREATE INDEX IF NOT EXISTS idx_gref_artists_run_genre ON public.genre_reference_artists(run_id, genre_id, rank_in_genre);
CREATE INDEX IF NOT EXISTS idx_gref_artists_norm ON public.genre_reference_artists(artist_norm);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.genre_reference_artists TO authenticated;
GRANT ALL ON public.genre_reference_artists TO service_role;
ALTER TABLE public.genre_reference_artists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gref_artists_admin" ON public.genre_reference_artists
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.genre_reference_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.genre_reference_runs(id) ON DELETE CASCADE,
  genre_id uuid NOT NULL,
  genre_name text NOT NULL,
  track_key text NOT NULL,
  track_name text NOT NULL,
  artist_name text NOT NULL,
  spotify_track_id text,
  playlists_in_genre integer NOT NULL DEFAULT 0,
  instances_in_genre integer NOT NULL DEFAULT 0,
  total_instances_all_genres integer NOT NULL DEFAULT 0,
  genres_present integer NOT NULL DEFAULT 0,
  purity_pct numeric NOT NULL DEFAULT 0,
  authority_score numeric NOT NULL DEFAULT 0,
  rank_in_genre integer,
  UNIQUE (run_id, genre_id, track_key)
);
CREATE INDEX IF NOT EXISTS idx_gref_tracks_run_genre ON public.genre_reference_tracks(run_id, genre_id, rank_in_genre);
CREATE INDEX IF NOT EXISTS idx_gref_tracks_key ON public.genre_reference_tracks(track_key);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.genre_reference_tracks TO authenticated;
GRANT ALL ON public.genre_reference_tracks TO service_role;
ALTER TABLE public.genre_reference_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gref_tracks_admin" ON public.genre_reference_tracks
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.genre_reference_playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.genre_reference_runs(id) ON DELETE CASCADE,
  genre_id uuid NOT NULL,
  genre_name text NOT NULL,
  playlist_id uuid NOT NULL,
  playlist_name text,
  followers bigint DEFAULT 0,
  tracks_total integer NOT NULL DEFAULT 0,
  tracks_authority_in_genre numeric NOT NULL DEFAULT 0,
  internal_purity_pct numeric NOT NULL DEFAULT 0,
  authority_score numeric NOT NULL DEFAULT 0,
  rank_in_genre integer,
  UNIQUE (run_id, genre_id, playlist_id)
);
CREATE INDEX IF NOT EXISTS idx_gref_playlists_run_genre ON public.genre_reference_playlists(run_id, genre_id, rank_in_genre);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.genre_reference_playlists TO authenticated;
GRANT ALL ON public.genre_reference_playlists TO service_role;
ALTER TABLE public.genre_reference_playlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gref_playlists_admin" ON public.genre_reference_playlists
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

DO $$
DECLARE v_run uuid;
BEGIN
  INSERT INTO public.genre_reference_runs DEFAULT VALUES RETURNING id INTO v_run;

  CREATE TEMP TABLE _signal ON COMMIT DROP AS
  SELECT mp.genre_id,
         lower(btrim(mpt.artist_name)) AS artist_norm,
         btrim(mpt.artist_name) AS artist_name,
         lower(btrim(mpt.artist_name)) || '||' || lower(btrim(mpt.track_name)) AS track_key,
         btrim(mpt.track_name) AS track_name,
         mpt.spotify_track_id,
         mp.id AS playlist_id, 1::int AS weight
  FROM public.managed_playlist_tracks mpt
  JOIN public.managed_playlists mp ON mp.id = mpt.playlist_id
  WHERE mp.genre_id IS NOT NULL AND mp.archived_at IS NULL
    AND mpt.artist_name IS NOT NULL AND btrim(mpt.artist_name) <> ''
    AND mpt.track_name IS NOT NULL AND btrim(mpt.track_name) <> ''
  UNION ALL
  SELECT st.genre_id,
         lower(btrim(st.artista)),
         btrim(st.artista),
         lower(btrim(st.artista)) || '||' || lower(btrim(st.nome_musica)),
         btrim(st.nome_musica),
         st.spotify_track_id,
         NULL::uuid, 2::int
  FROM public.search_tracks st
  WHERE st.genre_id IS NOT NULL
    AND st.artista IS NOT NULL AND btrim(st.artista) <> ''
    AND st.nome_musica IS NOT NULL AND btrim(st.nome_musica) <> '';

  -- ARTISTS
  WITH per_genre AS (
    SELECT genre_id, artist_norm,
           max(artist_name) AS artist_name,
           sum(weight)::int AS instances,
           count(DISTINCT playlist_id) FILTER (WHERE playlist_id IS NOT NULL) AS playlists
    FROM _signal GROUP BY genre_id, artist_norm
  ),
  totals AS (
    SELECT artist_norm,
           sum(instances)::int AS total_instances,
           count(DISTINCT genre_id)::int AS genres_present
    FROM per_genre GROUP BY artist_norm
  ),
  joined AS (
    SELECT pg.*, t.total_instances, t.genres_present,
           round((100.0 * pg.instances / NULLIF(t.total_instances,0))::numeric, 2) AS purity_pct,
           round((ln(1 + pg.instances::numeric) * (pg.instances::numeric / NULLIF(t.total_instances,0)) * 100)::numeric, 3) AS authority_score
    FROM per_genre pg JOIN totals t USING (artist_norm)
  ),
  ranked AS (
    SELECT j.*, row_number() OVER (PARTITION BY genre_id ORDER BY authority_score DESC, instances DESC) AS rk
    FROM joined j
  )
  INSERT INTO public.genre_reference_artists
    (run_id, genre_id, genre_name, artist_norm, artist_name,
     playlists_in_genre, track_instances_in_genre, total_instances_all_genres,
     genres_present, purity_pct, authority_score, rank_in_genre)
  SELECT v_run, r.genre_id, g.nome, r.artist_norm, r.artist_name,
         COALESCE(r.playlists,0), r.instances, r.total_instances,
         r.genres_present, COALESCE(r.purity_pct,0), COALESCE(r.authority_score,0), r.rk
  FROM ranked r JOIN public.genres g ON g.id = r.genre_id
  WHERE r.rk <= 200;

  -- TRACKS
  WITH per_genre AS (
    SELECT genre_id, track_key,
           max(track_name) AS track_name,
           max(artist_name) AS artist_name,
           max(spotify_track_id) AS spotify_track_id,
           sum(weight)::int AS instances,
           count(DISTINCT playlist_id) FILTER (WHERE playlist_id IS NOT NULL) AS playlists
    FROM _signal GROUP BY genre_id, track_key
  ),
  totals AS (
    SELECT track_key,
           sum(instances)::int AS total_instances,
           count(DISTINCT genre_id)::int AS genres_present
    FROM per_genre GROUP BY track_key
  ),
  joined AS (
    SELECT pg.*, t.total_instances, t.genres_present,
           round((100.0 * pg.instances / NULLIF(t.total_instances,0))::numeric, 2) AS purity_pct,
           round((ln(1 + pg.instances::numeric) * (pg.instances::numeric / NULLIF(t.total_instances,0)) * 100)::numeric, 3) AS authority_score
    FROM per_genre pg JOIN totals t USING (track_key)
  ),
  ranked AS (
    SELECT j.*, row_number() OVER (PARTITION BY genre_id ORDER BY authority_score DESC, instances DESC) AS rk
    FROM joined j
  )
  INSERT INTO public.genre_reference_tracks
    (run_id, genre_id, genre_name, track_key, track_name, artist_name, spotify_track_id,
     playlists_in_genre, instances_in_genre, total_instances_all_genres,
     genres_present, purity_pct, authority_score, rank_in_genre)
  SELECT v_run, r.genre_id, g.nome, r.track_key, r.track_name, r.artist_name, r.spotify_track_id,
         COALESCE(r.playlists,0), r.instances, r.total_instances,
         r.genres_present, COALESCE(r.purity_pct,0), COALESCE(r.authority_score,0), r.rk
  FROM ranked r JOIN public.genres g ON g.id = r.genre_id
  WHERE r.rk <= 200;

  -- PLAYLISTS
  WITH artist_purity AS (
    SELECT genre_id, artist_norm, purity_pct
    FROM public.genre_reference_artists WHERE run_id = v_run
  ),
  pl_tracks AS (
    SELECT mp.id AS playlist_id, mp.genre_id, mp.name, mp.followers,
           lower(btrim(mpt.artist_name)) AS artist_norm
    FROM public.managed_playlists mp
    JOIN public.managed_playlist_tracks mpt ON mpt.playlist_id = mp.id
    WHERE mp.genre_id IS NOT NULL AND mp.archived_at IS NULL
      AND mpt.artist_name IS NOT NULL AND btrim(mpt.artist_name) <> ''
  ),
  agg AS (
    SELECT p.playlist_id, p.genre_id, max(p.name) AS name, max(p.followers) AS followers,
           count(*) AS tracks_total,
           sum(CASE WHEN COALESCE(ap.purity_pct,0) >= 70 THEN 1 ELSE 0 END)::numeric AS pure_tracks
    FROM pl_tracks p
    LEFT JOIN artist_purity ap ON ap.genre_id = p.genre_id AND ap.artist_norm = p.artist_norm
    GROUP BY p.playlist_id, p.genre_id
  ),
  ranked AS (
    SELECT a.*,
           round((100.0 * a.pure_tracks / NULLIF(a.tracks_total,0))::numeric, 2) AS internal_purity_pct,
           round((ln(1 + COALESCE(a.followers,0)::numeric) * (a.pure_tracks / NULLIF(a.tracks_total,0)))::numeric, 3) AS authority_score,
           row_number() OVER (
             PARTITION BY a.genre_id
             ORDER BY (a.pure_tracks / NULLIF(a.tracks_total,0)) DESC NULLS LAST,
                      COALESCE(a.followers,0) DESC
           ) AS rk
    FROM agg a
  )
  INSERT INTO public.genre_reference_playlists
    (run_id, genre_id, genre_name, playlist_id, playlist_name, followers,
     tracks_total, tracks_authority_in_genre, internal_purity_pct, authority_score, rank_in_genre)
  SELECT v_run, r.genre_id, g.nome, r.playlist_id, r.name, COALESCE(r.followers,0),
         r.tracks_total, COALESCE(r.pure_tracks,0), COALESCE(r.internal_purity_pct,0),
         COALESCE(r.authority_score,0), r.rk
  FROM ranked r JOIN public.genres g ON g.id = r.genre_id;

  UPDATE public.genre_reference_runs
  SET finished_at = now(),
      notes = jsonb_build_object(
        'artists', (SELECT count(*) FROM public.genre_reference_artists WHERE run_id = v_run),
        'tracks',  (SELECT count(*) FROM public.genre_reference_tracks  WHERE run_id = v_run),
        'playlists',(SELECT count(*) FROM public.genre_reference_playlists WHERE run_id = v_run)
      )
  WHERE id = v_run;
END $$;