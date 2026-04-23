ALTER TABLE public.playlist_templates
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS cover_variations jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cover_selected_index integer,
  ADD COLUMN IF NOT EXISTS cover_generated_at timestamptz;

INSERT INTO storage.buckets (id, name, public)
VALUES ('playlist-covers', 'playlist-covers', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read playlist-covers" ON storage.objects;
CREATE POLICY "Public read playlist-covers"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'playlist-covers');