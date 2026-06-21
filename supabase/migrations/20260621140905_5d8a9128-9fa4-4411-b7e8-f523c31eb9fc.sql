
-- Snapshot dos caps atuais antes de reverter
INSERT INTO public._spotify_apps_caps_snapshots
  (app_id, app_name, lifecycle_state, max_accounts, max_playlists, soft_capacity_cap, reason, taken_at)
SELECT id, name, lifecycle_state, max_accounts, max_playlists, soft_capacity_cap,
       'revert_to_real_dev_cap_5_accounts_400_playlists', now()
FROM public.spotify_apps;

-- Reverter caps dos apps active para o limite operacional real
UPDATE public.spotify_apps
SET max_accounts = 5,
    max_playlists = 400,
    updated_at = now()
WHERE lifecycle_state = 'active';

-- Reativar NE09 (estava quarantined, operacionalmente OK)
UPDATE public.spotify_apps
SET lifecycle_state = 'active',
    quarantined_until = NULL,
    quarantine_reason = NULL,
    blocked_reason = NULL,
    removed_from_pool_at = NULL,
    max_accounts = 5,
    max_playlists = 400,
    updated_at = now()
WHERE name = 'NexEngine 09';
