
DO $$
DECLARE
  -- Funções que ficam SÓ para service role (revogar de PUBLIC, sem regrant)
  service_only text[] := ARRAY[
    -- Plumbing
    'enqueue_email(text, jsonb)',
    'delete_email(text, bigint)',
    'read_email_batch(text, integer, integer)',
    'move_to_dlq(text, text, bigint, jsonb)',
    'bump_rate_limit(text, integer, integer)',
    'bump_ai_quota(uuid, date, bigint)',
    'log_ai_usage(uuid, text, text, text, integer, integer, integer, integer, text, text, jsonb)',
    -- Cron / manutenção
    'cleanup_old_bot_prints()',
    'cleanup_old_logs()',
    'cleanup_old_logs_and_snapshots()',
    'cleanup_operational_logs()',
    'cleanup_rate_limits_and_ai_cache()',
    'cleanup_spotify_oauth_states()',
    'cleanup_stale_autopilot_runs(integer)',
    'expire_stale_medium_templates(integer)',
    'recalc_curator_totals()',
    'recalc_playlist_scores()',
    'reconcile_account_playlist_counts()',
    'reconcile_genre_counts()',
    'recover_stuck_auto_collect()',
    'recover_stuck_print_batches()',
    'auto_mark_late_discovery()',
    'community_audit_report()',
    'community_expire_stale()',
    'evaluate_pending_impacts()',
    -- Triggers
    'auto_create_account_for_token()',
    'check_campaign_activation_no_conflict()',
    'check_campaign_eco_allocation_uniqueness()',
    'community_members_block_self_escalation()',
    'community_members_guard_protected()',
    'community_members_lock_sensitive_fields()',
    'curator_deals_token_coherence()',
    'decrement_account_on_template_release()',
    'deprecation_block_jobs_queue()',
    'enforce_admin_role_changes()',
    'enforce_curator_playlist_baseline()',
    'ensure_scored_at_on_approval()',
    'guard_deprecated_jobs_fn()',
    'managed_playlists_inherit_curator()',
    'prevent_community_participation_self_escalation()',
    'prevent_last_admin_delete()',
    'prevent_oauth_state_reuse()',
    'sync_campaign_total_allocated()',
    'sync_campaign_total_delivered()',
    'sync_curator_playlist_streams_from_snapshot()',
    'sync_playlist_to_library()',
    'tg_campaign_shadow_close()',
    'tg_campaign_shadow_deal()',
    'trg_auto_apply_cooldown()',
    'trg_open_impact_window()',
    'trg_recompute_deal_state()',
    'trigger_recalc_playlist_scores()',
    'monitor_cron_http_failures()'
  ];

  -- Funções operacionais/comunidade: revogar PUBLIC, re-conceder a authenticated
  auth_only text[] := ARRAY[
    -- Comunidade
    'community_my_participations()',
    'community_member_points(uuid)',
    'community_submit_proof(uuid, text)',
    'community_accept_campaign(uuid)',
    'community_list_open_campaigns()',
    'notify_member(uuid, text, text, text, text, text, jsonb)',
    'approve_campaign(uuid)',
    'community_review_participation(uuid, text, text)',
    'community_revert_participation(uuid, text)',
    'community_recompute_member(uuid)',
    -- Domínio operacional
    'apply_playlist_cooldown(uuid, curatorial_action_type, text, integer, uuid)',
    'create_curator_deal_atomic(jsonb, jsonb, boolean, jsonb)',
    'create_curator_deal_atomic(jsonb, jsonb, boolean)',
    'record_curator_deal_capture(uuid, uuid, bigint, boolean, text, text[], jsonb, jsonb, timestamp with time zone)',
    'recompute_curator_deal_state(uuid)',
    'recompute_curator_deal_totals(uuid)',
    'recalc_campaign_progress(uuid)',
    'notify_baseline_missing(uuid)',
    'pick_next_account(text, uuid)',
    'increment_account_playlists(text)',
    'match_curator_playlist(uuid, text, text, uuid)',
    'detect_duplicate_curator_deal(uuid, uuid, text, text, text, timestamp with time zone, timestamp with time zone)',
    'detect_duplicate_curator_playlists(uuid)',
    'suggest_campaign_playlists(bigint, date, boolean)',
    'compare_genre_versions(uuid, integer, integer)',
    'get_active_replication_rules(uuid)',
    'get_followers_revalidation_candidates(integer, integer, interval)',
    'get_low_performance_candidates(integer, integer, integer)',
    'get_performance_class_for_source(uuid)',
    'get_performance_dataset(integer)',
    'get_genre_daily_target_v2(uuid)',
    'get_learning_loop_status()',
    'get_campaign_analytics_overview()',
    'get_curator_deal_breakdown(uuid)',
    'get_curator_deal_progress(uuid, uuid)',
    'get_curator_deal_snapshot_history(uuid)',
    'is_playlist_action_blocked(uuid, curatorial_action_type)',
    'is_playlist_in_deal_baseline(uuid, text, uuid)',
    'is_playlist_in_deal_baseline(uuid, text)',
    'count_recent_backfill_attempts(uuid, integer)',
    'create_notification(text, text, text, text, jsonb, text, integer)',
    'create_notification(notification_type, text, text, text, jsonb)',
    'evaluate_playlist(text)',
    'evaluate_playlist_by_url(text)',
    'evaluate_playlists_batch(text[])',
    'get_active_cooldowns(uuid)'
  ];

  fn text;
BEGIN
  FOREACH fn IN ARRAY service_only LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;

  FOREACH fn IN ARRAY auth_only LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END $$;
