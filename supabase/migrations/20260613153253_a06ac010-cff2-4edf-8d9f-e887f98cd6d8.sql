
DELETE FROM public.curator_playlists WHERE frozen_at IS NULL;

DO $$
DECLARE
  v_cp_total int; v_cp_unique int;
  v_active_camps int; v_active_curs int;
  v_archive int;
  v_frozen_active int; v_frozen_proof int;
  v_fk_plan int; v_fk_proofs int;
BEGIN
  SELECT COUNT(*) INTO v_cp_total FROM public.curator_playlists;
  SELECT COUNT(DISTINCT spotify_playlist_id) INTO v_cp_unique
    FROM public.curator_playlists WHERE spotify_playlist_id IS NOT NULL;
  SELECT COUNT(DISTINCT cd.campaign_id) INTO v_active_camps
    FROM public.curator_playlists cp
    JOIN public.curator_deals cd ON cd.id = cp.deal_id
    JOIN public.campaigns c ON c.id = cd.campaign_id
    WHERE c.status = 'active';
  SELECT COUNT(DISTINCT cd.curator_id) INTO v_active_curs
    FROM public.curator_playlists cp
    JOIN public.curator_deals cd ON cd.id = cp.deal_id
    JOIN public.campaigns c ON c.id = cd.campaign_id
    WHERE c.status = 'active';
  SELECT COUNT(*) INTO v_archive FROM public.curator_playlists_archive;
  SELECT COUNT(*) INTO v_frozen_active FROM public.curator_playlists WHERE frozen_reason='active_campaign';
  SELECT COUNT(*) INTO v_frozen_proof FROM public.curator_playlists WHERE frozen_reason='delivery_proof_immutable';
  SELECT COUNT(*) INTO v_fk_plan FROM public.curator_deal_plan cdp
    WHERE NOT EXISTS (SELECT 1 FROM public.curator_playlists WHERE id = cdp.curator_playlist_id);
  SELECT COUNT(*) INTO v_fk_proofs FROM public.delivery_proofs dp
    WHERE dp.playlist_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.curator_playlists WHERE id = dp.playlist_id);

  RAISE NOTICE '===== AUDITORIA POS-DELETE =====';
  RAISE NOTICE 'curator_playlists TOTAL ............... %', v_cp_total;
  RAISE NOTICE 'curator_playlists UNICAS (spotify_id) . %', v_cp_unique;
  RAISE NOTICE 'campanhas ativas cobertas ............. %', v_active_camps;
  RAISE NOTICE 'curadores ativos cobertos ............. %', v_active_curs;
  RAISE NOTICE 'curator_playlists_archive ............. %', v_archive;
  RAISE NOTICE 'frozen_reason=active_campaign ......... %', v_frozen_active;
  RAISE NOTICE 'frozen_reason=delivery_proof_immutable  %', v_frozen_proof;
  RAISE NOTICE 'FK orfa curator_deal_plan ............. %', v_fk_plan;
  RAISE NOTICE 'FK orfa delivery_proofs ............... %', v_fk_proofs;
END $$;
