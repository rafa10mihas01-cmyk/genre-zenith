-- P1.3: limpar playlist órfã sem spotify_playlist_id (URL truncada, nome "Sem nome")
-- Quebra dedup e poluí enrich. Tracks dela vão junto via FK lógica (result_id).
DELETE FROM public.search_tracks
WHERE result_id = 'f69d7e6a-4aec-48fc-b56c-668004d784cb';

DELETE FROM public.search_results
WHERE id = 'f69d7e6a-4aec-48fc-b56c-668004d784cb';