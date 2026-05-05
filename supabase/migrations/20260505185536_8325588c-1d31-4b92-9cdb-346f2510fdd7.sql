-- Garantir REPLICA IDENTITY FULL para enviar payloads completos em UPDATEs
ALTER TABLE public.curator_deal_songs REPLICA IDENTITY FULL;

-- Adicionar tabela à publicação de realtime (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'curator_deal_songs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.curator_deal_songs';
  END IF;
END $$;