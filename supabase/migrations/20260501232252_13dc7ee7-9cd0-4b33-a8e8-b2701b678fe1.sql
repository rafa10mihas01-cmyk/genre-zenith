-- 1) Coluna para guardar URLs dos prints associados ao log
ALTER TABLE public.curator_deal_logs
  ADD COLUMN IF NOT EXISTS print_urls text[] NOT NULL DEFAULT ARRAY[]::text[];

-- 2) Bucket público para prints dos deals
INSERT INTO storage.buckets (id, name, public)
VALUES ('deal-prints', 'deal-prints', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3) Policies de storage
-- Leitura pública (qualquer um com a URL)
DROP POLICY IF EXISTS "deal-prints public read" ON storage.objects;
CREATE POLICY "deal-prints public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'deal-prints');

-- Upload: qualquer usuário autenticado (dono do deal já é checado pela RLS de curator_deal_logs ao inserir o registro)
DROP POLICY IF EXISTS "deal-prints authenticated upload" ON storage.objects;
CREATE POLICY "deal-prints authenticated upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'deal-prints');

-- Update / Delete somente do próprio uploader
DROP POLICY IF EXISTS "deal-prints owner update" ON storage.objects;
CREATE POLICY "deal-prints owner update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'deal-prints' AND auth.uid() = owner);

DROP POLICY IF EXISTS "deal-prints owner delete" ON storage.objects;
CREATE POLICY "deal-prints owner delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'deal-prints' AND auth.uid() = owner);