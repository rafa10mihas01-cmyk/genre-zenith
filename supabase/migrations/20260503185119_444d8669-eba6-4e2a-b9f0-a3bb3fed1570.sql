-- 1) Coluna last_print_at em curator_deal_songs
ALTER TABLE public.curator_deal_songs
  ADD COLUMN IF NOT EXISTS last_print_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_curator_deal_songs_last_print_at
  ON public.curator_deal_songs(last_print_at);

-- 2) Bucket bot-prints (privado)
INSERT INTO storage.buckets (id, name, public)
VALUES ('bot-prints', 'bot-prints', false)
ON CONFLICT (id) DO NOTHING;

-- 3) Policies do bucket
DROP POLICY IF EXISTS "Team can view bot prints" ON storage.objects;
CREATE POLICY "Team can view bot prints"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'bot-prints' AND public.has_team_access());

DROP POLICY IF EXISTS "Team can manage bot prints" ON storage.objects;
CREATE POLICY "Team can manage bot prints"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'bot-prints' AND public.has_team_access())
WITH CHECK (bucket_id = 'bot-prints' AND public.has_team_access());