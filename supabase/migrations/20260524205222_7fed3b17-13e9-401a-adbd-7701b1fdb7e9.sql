
-- PASSO 3: Funções operacionais e de comunidade → exigir login
-- Revoga EXECUTE apenas de anon (authenticated mantém)

-- 2a. Comunidade
REVOKE EXECUTE ON FUNCTION public.community_my_participations() FROM anon;
REVOKE EXECUTE ON FUNCTION public.community_member_points(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.community_submit_proof(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.community_accept_campaign(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.community_list_open_campaigns() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_member(uuid, text, text, text, text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_campaign(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.community_review_participation(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.community_revert_participation(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.community_recompute_member(uuid) FROM anon;

-- 2b. Domínio operacional
REVOKE EXECUTE ON FUNCTION public.apply_playlist_cooldown(uuid, curatorial_action_type, text, integer, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_curator_deal_atomic(jsonb, jsonb, boolean, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_curator_deal_atomic(jsonb, jsonb, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_curator_deal_capture(uuid, uuid, bigint, boolean, text, text[], jsonb, jsonb, timestamp with time zone) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_curator_deal_state(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_curator_deal_totals(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recalc_campaign_progress(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_baseline_missing(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_next_account(text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_account_playlists(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_curator_playlist(uuid, text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.detect_duplicate_curator_deal(uuid, uuid, text, text, text, timestamp with time zone, timestamp with time zone) FROM anon;
REVOKE EXECUTE ON FUNCTION public.detect_duplicate_curator_playlists(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.suggest_campaign_playlists(bigint, date, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.compare_genre_versions(uuid, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_active_replication_rules(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_followers_revalidation_candidates(integer, integer, interval) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_low_performance_candidates(integer, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_performance_class_for_source(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_performance_dataset(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_genre_daily_target_v2(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_learning_loop_status() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_campaign_analytics_overview() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_curator_deal_breakdown(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_curator_deal_progress(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_curator_deal_snapshot_history(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_playlist_action_blocked(uuid, curatorial_action_type) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_playlist_in_deal_baseline(uuid, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_playlist_in_deal_baseline(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.count_recent_backfill_attempts(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_notification(text, text, text, text, jsonb, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_notification(notification_type, text, text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.evaluate_playlist(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.evaluate_playlist_by_url(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.evaluate_playlists_batch(text[]) FROM anon;

-- Bônus: get_active_cooldowns já estava anon=f, mas garantimos consistência
REVOKE EXECUTE ON FUNCTION public.get_active_cooldowns(uuid) FROM anon;
