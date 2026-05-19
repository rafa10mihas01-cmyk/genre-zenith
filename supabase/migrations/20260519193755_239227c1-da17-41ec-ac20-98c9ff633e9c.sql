-- 1. Tornar bucket deal-prints privado
UPDATE storage.buckets SET public = false WHERE id = 'deal-prints';

-- 2. Substituir SELECT público por team-only
DROP POLICY IF EXISTS "deal-prints public read" ON storage.objects;
CREATE POLICY "deal-prints team read"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'deal-prints' AND public.has_team_access());

-- 3. Restringir analytics internos ao time
DROP POLICY IF EXISTS "Authenticated read recommendation_outcome" ON public.recommendation_outcome;
CREATE POLICY "Team can read recommendation_outcome"
ON public.recommendation_outcome FOR SELECT
TO authenticated
USING (public.has_team_access());

DROP POLICY IF EXISTS "Authenticated can read fits" ON public.track_playlist_fit;
CREATE POLICY "Team can read track_playlist_fit"
ON public.track_playlist_fit FOR SELECT
TO authenticated
USING (public.has_team_access());

DROP POLICY IF EXISTS "Authenticated users can read ecosystem scores" ON public.track_ecosystem_score;
CREATE POLICY "Team can read track_ecosystem_score"
ON public.track_ecosystem_score FOR SELECT
TO authenticated
USING (public.has_team_access());

DROP POLICY IF EXISTS "Authenticated can read playlist scores" ON public.playlist_ecosystem_score;
CREATE POLICY "Team can read playlist_ecosystem_score"
ON public.playlist_ecosystem_score FOR SELECT
TO authenticated
USING (public.has_team_access());