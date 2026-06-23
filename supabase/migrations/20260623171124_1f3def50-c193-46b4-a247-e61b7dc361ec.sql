DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'engine_priority_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.engine_priority_runs;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'placement_priority_scores'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.placement_priority_scores;
  END IF;
END $$;