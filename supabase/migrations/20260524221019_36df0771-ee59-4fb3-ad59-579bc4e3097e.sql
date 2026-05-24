-- Public read for playlist-covers bucket (bucket is public=true; align RLS with intent)
DROP POLICY IF EXISTS "Public can read playlist covers" ON storage.objects;
CREATE POLICY "Public can read playlist covers"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'playlist-covers');