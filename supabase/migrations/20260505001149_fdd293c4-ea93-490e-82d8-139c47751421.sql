-- Corrige playlists que foram criadas pela auto-coleta de baseline
-- mas ficaram marcadas como is_baseline=false (default), o que fazia
-- elas serem contadas como entrega do curador.
-- Critério: playlist cujo PRIMEIRO snapshot é is_baseline=true => ela existia antes do curador.
UPDATE public.curator_playlists cp
SET is_baseline = true
WHERE cp.is_baseline = false
  AND EXISTS (
    SELECT 1 FROM public.curator_deal_snapshots s
    WHERE s.playlist_id = cp.id
    GROUP BY s.playlist_id
    HAVING bool_and(s.is_baseline) = true
  );