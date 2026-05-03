-- 1) Bucket público para prints da coleta automática
INSERT INTO storage.buckets (id, name, public)
VALUES ('deal-prints', 'deal-prints', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Leitura pública
DROP POLICY IF EXISTS "deal-prints public read" ON storage.objects;
CREATE POLICY "deal-prints public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'deal-prints');

-- Apenas service role escreve (bot usa service key)
DROP POLICY IF EXISTS "deal-prints service insert" ON storage.objects;
CREATE POLICY "deal-prints service insert"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'deal-prints');

DROP POLICY IF EXISTS "deal-prints service update" ON storage.objects;
CREATE POLICY "deal-prints service update"
ON storage.objects FOR UPDATE
TO service_role
USING (bucket_id = 'deal-prints');

DROP POLICY IF EXISTS "deal-prints service delete" ON storage.objects;
CREATE POLICY "deal-prints service delete"
ON storage.objects FOR DELETE
TO service_role
USING (bucket_id = 'deal-prints');

-- 2) Intervalo padrão = 1x/dia (1440 min) para coleta automática
UPDATE public.curator_deal_songs
   SET auto_collect_interval_minutes = 1440,
       next_auto_collect_at = NULL
 WHERE auto_collect = true;

-- 3) Default da coluna pra 1440 (novas músicas já entram diárias)
ALTER TABLE public.curator_deal_songs
  ALTER COLUMN auto_collect_interval_minutes SET DEFAULT 1440;