-- 1) Histórico de uploads de planilha da gravadora
CREATE TABLE public.label_spreadsheet_uploads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id UUID NOT NULL REFERENCES public.curator_deals(id) ON DELETE CASCADE,
  song_id UUID REFERENCES public.curator_deal_songs(id) ON DELETE SET NULL,
  uploaded_via TEXT NOT NULL DEFAULT 'client_portal', -- 'client_portal' | 'internal'
  uploaded_by UUID, -- auth.users.id se interno; null se cliente público
  file_path TEXT NOT NULL,
  file_name TEXT,
  content_hash TEXT NOT NULL,
  rows_imported INT NOT NULL DEFAULT 0,
  total_streams BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'imported', -- 'imported' | 'duplicate' | 'failed'
  error_message TEXT,
  reference_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lsu_deal_created ON public.label_spreadsheet_uploads(deal_id, created_at DESC);
CREATE UNIQUE INDEX idx_lsu_dedupe ON public.label_spreadsheet_uploads(deal_id, content_hash, reference_date);

ALTER TABLE public.label_spreadsheet_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_lsu" ON public.label_spreadsheet_uploads
  FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_lsu" ON public.label_spreadsheet_uploads
  FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_delete_lsu" ON public.label_spreadsheet_uploads
  FOR DELETE TO authenticated USING (has_team_access());

-- 2) Lembretes enviados (idempotência de email)
CREATE TABLE public.label_spreadsheet_reminders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id UUID NOT NULL REFERENCES public.curator_deals(id) ON DELETE CASCADE,
  sent_for_date DATE NOT NULL DEFAULT CURRENT_DATE,
  recipient_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_lsr_dedupe ON public.label_spreadsheet_reminders(deal_id, sent_for_date);

ALTER TABLE public.label_spreadsheet_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_select_lsr" ON public.label_spreadsheet_reminders
  FOR SELECT TO authenticated USING (has_team_access());

-- 3) Função SECURITY DEFINER pra edge function validar client_token e devolver deal_id + song_id
CREATE OR REPLACE FUNCTION public.resolve_client_token(_token TEXT)
RETURNS TABLE(deal_id UUID, song_id UUID, has_spotify BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id AS deal_id,
    s.id AS song_id,
    (d.spotify_owner_id IS NOT NULL) AS has_spotify
  FROM public.curator_deals d
  LEFT JOIN public.curator_deal_songs s ON s.deal_id = d.id AND s.client_token = _token
  WHERE d.client_token = _token OR s.client_token = _token
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_client_token(TEXT) TO anon, authenticated;

-- 4) Storage bucket privado
INSERT INTO storage.buckets (id, name, public)
VALUES ('label-spreadsheets', 'label-spreadsheets', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: equipe lê tudo; insert é feito por edge function via service role (bypass).
CREATE POLICY "team_read_label_spreadsheets" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'label-spreadsheets' AND has_team_access());