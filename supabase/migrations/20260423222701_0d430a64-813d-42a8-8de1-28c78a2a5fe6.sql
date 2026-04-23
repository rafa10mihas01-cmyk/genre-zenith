-- Leitura pública das capas (bucket é público)
CREATE POLICY "playlist_covers_public_read"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'playlist-covers');

-- Upload restrito a membros da equipe
CREATE POLICY "playlist_covers_team_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'playlist-covers' AND public.has_team_access());

-- Atualização restrita a membros da equipe
CREATE POLICY "playlist_covers_team_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'playlist-covers' AND public.has_team_access())
  WITH CHECK (bucket_id = 'playlist-covers' AND public.has_team_access());

-- Remoção restrita a membros da equipe
CREATE POLICY "playlist_covers_team_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'playlist-covers' AND public.has_team_access());