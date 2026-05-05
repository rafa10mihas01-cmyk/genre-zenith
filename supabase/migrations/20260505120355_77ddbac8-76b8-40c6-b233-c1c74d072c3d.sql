
-- 1. Unique constraints (anti-duplicata)
CREATE UNIQUE INDEX IF NOT EXISTS curator_playlists_deal_spotify_unique
  ON public.curator_playlists (deal_id, spotify_playlist_id)
  WHERE spotify_playlist_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS curator_deal_snapshots_playlist_captured_unique
  ON public.curator_deal_snapshots (playlist_id, captured_at);

-- 2. Função para detectar batches travados (status=complete mas processed_at nulo há +5min)
CREATE OR REPLACE FUNCTION public.recover_stuck_print_batches()
RETURNS TABLE(batch_id uuid, deal_id uuid, song_id uuid, print_urls jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, deal_id, song_id, print_urls
  FROM public.bot_print_batches
  WHERE status = 'complete'
    AND processed_at IS NULL
    AND completed_at < (now() - interval '5 minutes')
  ORDER BY completed_at ASC
  LIMIT 20;
$$;
