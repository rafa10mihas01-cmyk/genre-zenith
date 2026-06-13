
-- 1. arquivar as 36 placeholders algorítmicos
INSERT INTO public.curator_playlists_archive (original_id, archive_reason, original_row)
SELECT cp.id, 'algorithmic_placeholder_in_active_campaign', to_jsonb(cp.*)
FROM public.curator_playlists cp
WHERE cp.frozen_at IS NOT NULL
  AND (cp.spotify_playlist_id IS NULL OR cp.spotify_playlist_id = '')
  AND NOT EXISTS (
    SELECT 1 FROM public.curator_playlists_archive a WHERE a.original_id = cp.id
  );

-- 2. remover da camada operacional
DELETE FROM public.curator_playlists
WHERE frozen_at IS NOT NULL
  AND (spotify_playlist_id IS NULL OR spotify_playlist_id = '');

-- 3. auditoria final
DO $$
DECLARE
  v_total int; v_com_id int; v_sem_id int; v_id_invalido int;
  v_archive int; v_arch_algo int;
  v_match_problem int;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.curator_playlists;
  SELECT COUNT(*) INTO v_com_id FROM public.curator_playlists WHERE spotify_playlist_id IS NOT NULL AND spotify_playlist_id <> '';
  SELECT COUNT(*) INTO v_sem_id FROM public.curator_playlists WHERE spotify_playlist_id IS NULL OR spotify_playlist_id = '';
  SELECT COUNT(*) INTO v_id_invalido FROM public.curator_playlists WHERE spotify_playlist_id !~ '^[A-Za-z0-9]{22}$';
  SELECT COUNT(*) INTO v_archive FROM public.curator_playlists_archive;
  SELECT COUNT(*) INTO v_arch_algo FROM public.curator_playlists_archive WHERE archive_reason='algorithmic_placeholder_in_active_campaign';
  SELECT COUNT(*) INTO v_match_problem FROM public.curator_playlists WHERE match_status IN ('name_match','fuzzy','suspicious','algorithmic');

  RAISE NOTICE '===== AUDITORIA FINAL CAMADA OPERACIONAL =====';
  RAISE NOTICE 'curator_playlists TOTAL ............... %', v_total;
  RAISE NOTICE 'COM spotify_playlist_id ............... %', v_com_id;
  RAISE NOTICE 'SEM spotify_playlist_id ............... %', v_sem_id;
  RAISE NOTICE 'ID em formato invalido ................ %', v_id_invalido;
  RAISE NOTICE 'match_status problematico ............. %', v_match_problem;
  RAISE NOTICE 'archive TOTAL ......................... %', v_archive;
  RAISE NOTICE 'archive algorithmic_placeholder ....... %', v_arch_algo;
END $$;
