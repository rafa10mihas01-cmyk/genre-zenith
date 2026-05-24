
-- PASSO 1: Plumbing interno + cron/manutenção → só service role
-- Revoga EXECUTE de anon e authenticated

-- 2c. Plumbing
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_rate_limit(text, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_ai_quota(uuid, date, bigint) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_ai_usage(uuid, text, text, text, integer, integer, integer, integer, text, text, jsonb) FROM anon, authenticated;

-- 2d. Cron/manutenção
REVOKE EXECUTE ON FUNCTION public.cleanup_old_bot_prints() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_logs() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_logs_and_snapshots() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_operational_logs() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits_and_ai_cache() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_spotify_oauth_states() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_stale_autopilot_runs(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_stale_medium_templates(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_curator_totals() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_playlist_scores() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_account_playlist_counts() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_genre_counts() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recover_stuck_auto_collect() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recover_stuck_print_batches() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_mark_late_discovery() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.community_audit_report() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.community_expire_stale() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.evaluate_pending_impacts() FROM anon, authenticated;
