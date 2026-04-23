-- Restringir SELECT em storage.objects ao time (URLs públicas continuam funcionando)
DROP POLICY IF EXISTS "playlist_covers_public_read" ON storage.objects;

CREATE POLICY "playlist_covers_team_read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'playlist-covers' AND public.has_team_access());