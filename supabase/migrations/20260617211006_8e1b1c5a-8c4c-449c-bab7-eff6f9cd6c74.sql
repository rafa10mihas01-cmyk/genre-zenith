
-- =====================================================================
-- NC-001: trigger duplicada em curator_deal_snapshots
-- =====================================================================
-- reject_snapshot_regression       : BEFORE INSERT OR UPDATE  (canônica, mais ampla)
-- trg_reject_snapshot_regression   : BEFORE INSERT            (subset)
DROP TRIGGER IF EXISTS trg_reject_snapshot_regression ON public.curator_deal_snapshots;

-- =====================================================================
-- NC-005: índices em FKs sem suporte
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_search_results_term_id ON public.search_results(term_id);
CREATE INDEX IF NOT EXISTS idx_collection_logs_term_id ON public.collection_logs(term_id);
CREATE INDEX IF NOT EXISTS idx_accounts_spotify_user_token_id ON public.accounts(spotify_user_token_id);
CREATE INDEX IF NOT EXISTS idx_replications_account_id ON public.replications(account_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_created_by ON public.user_roles(created_by);
CREATE INDEX IF NOT EXISTS idx_spotify_invite_tokens_created_by ON public.spotify_invite_tokens(created_by);
CREATE INDEX IF NOT EXISTS idx_curator_fraud_alerts_playlist_id ON public.curator_fraud_alerts(playlist_id);
CREATE INDEX IF NOT EXISTS idx_curator_paste_imports_song_id ON public.curator_paste_imports(song_id);
CREATE INDEX IF NOT EXISTS idx_cepi_curator_deal_id ON public.campaign_external_package_items(curator_deal_id);
CREATE INDEX IF NOT EXISTS idx_community_members_invite_id ON public.community_members(invite_id);
CREATE INDEX IF NOT EXISTS idx_spotify_oauth_states_app_id ON public.spotify_oauth_states(app_id);
CREATE INDEX IF NOT EXISTS idx_label_spreadsheet_uploads_song_id ON public.label_spreadsheet_uploads(song_id);
CREATE INDEX IF NOT EXISTS idx_playlist_execution_jobs_playlist_id ON public.playlist_execution_jobs(playlist_id);
CREATE INDEX IF NOT EXISTS idx_curator_deal_payments_created_by ON public.curator_deal_payments(created_by);
CREATE INDEX IF NOT EXISTS idx_genre_brain_parent_genre_id ON public.genre_brain(parent_genre_id);
CREATE INDEX IF NOT EXISTS idx_delivery_proofs_song_id ON public.delivery_proofs(song_id);
CREATE INDEX IF NOT EXISTS idx_delivery_proofs_playlist_id ON public.delivery_proofs(playlist_id);
CREATE INDEX IF NOT EXISTS idx_spotify_accounts_default_curator_id ON public.spotify_accounts(default_curator_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_plan_approved_by ON public.campaigns(plan_approved_by);
CREATE INDEX IF NOT EXISTS idx_cds_snapshot_run_id ON public.curator_deal_snapshots(snapshot_run_id);
CREATE INDEX IF NOT EXISTS idx_ccp_deal_id ON public.curator_campaign_playlists(deal_id);
CREATE INDEX IF NOT EXISTS idx_playlist_dna_dominant_subgenre_id ON public.playlist_dna(dominant_subgenre_id);
CREATE INDEX IF NOT EXISTS idx_pdlp_parent_genre_id ON public.playlist_dna_lexicon_proposals(parent_genre_id);
CREATE INDEX IF NOT EXISTS idx_cpel_managed_playlist_id ON public.catalog_placement_execution_log(managed_playlist_id);
CREATE INDEX IF NOT EXISTS idx_lsu_superseded_by ON public.label_spreadsheet_uploads(superseded_by);
CREATE INDEX IF NOT EXISTS idx_observed_playlists_promoted_to ON public.observed_playlists(promoted_to_curator_playlist_id);
CREATE INDEX IF NOT EXISTS idx_genre_aliases_genre_id ON public.genre_aliases(genre_id);
CREATE INDEX IF NOT EXISTS idx_csq_completed_snapshot_id ON public.catalog_snapshot_queue(completed_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_pto_curator_id ON public.playlists_to_observe(curator_id);
CREATE INDEX IF NOT EXISTS idx_playlist_observations_playlist_id ON public.playlist_observations(playlist_id);

-- =====================================================================
-- NC-006: RLS em _io_stats_snapshots
-- =====================================================================
ALTER TABLE public._io_stats_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._io_stats_snapshots FROM anon, authenticated;
GRANT ALL ON public._io_stats_snapshots TO service_role;
DROP POLICY IF EXISTS "service_role full access" ON public._io_stats_snapshots;
CREATE POLICY "service_role full access"
  ON public._io_stats_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =====================================================================
-- NC-007: unifica escrita de campaigns.total_delivered
-- Antes: sync_campaign_total_delivered (trigger) + recompute_campaign_total_delivered (cron)
-- Agora: trigger delega 100% para a RPC oficial — uma única definição.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.sync_campaign_total_delivered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_campaign uuid := NULL;
  v_new_campaign uuid := NULL;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    v_old_campaign := OLD.campaign_id;
  END IF;
  IF TG_OP IN ('UPDATE','INSERT') THEN
    v_new_campaign := NEW.campaign_id;
  END IF;

  IF v_new_campaign IS NOT NULL THEN
    PERFORM public.recompute_campaign_total_delivered(v_new_campaign);
  END IF;
  IF v_old_campaign IS NOT NULL AND v_old_campaign IS DISTINCT FROM v_new_campaign THEN
    PERFORM public.recompute_campaign_total_delivered(v_old_campaign);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
