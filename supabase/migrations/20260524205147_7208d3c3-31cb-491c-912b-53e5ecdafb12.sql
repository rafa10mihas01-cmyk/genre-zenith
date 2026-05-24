
-- PASSO 2: Funções de trigger → não devem ser chamáveis via API
-- Revoga EXECUTE de anon e authenticated em todas as trigger functions

REVOKE EXECUTE ON FUNCTION public.auto_create_account_for_token() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_campaign_activation_no_conflict() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_campaign_eco_allocation_uniqueness() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.community_members_block_self_escalation() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.community_members_guard_protected() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.community_members_lock_sensitive_fields() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.curator_deals_token_coherence() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_account_on_template_release() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deprecation_block_jobs_queue() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_admin_role_changes() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_curator_playlist_baseline() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_scored_at_on_approval() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_deprecated_jobs_fn() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.managed_playlists_inherit_curator() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_community_participation_self_escalation() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_last_admin_delete() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_oauth_state_reuse() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_campaign_total_allocated() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_campaign_total_delivered() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_curator_playlist_streams_from_snapshot() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_playlist_to_library() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_campaign_shadow_close() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_campaign_shadow_deal() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_auto_apply_cooldown() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_open_impact_window() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_recompute_deal_state() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_recalc_playlist_scores() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.monitor_cron_http_failures() FROM anon, authenticated;
