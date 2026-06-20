UPDATE public.spotify_apps
SET status = 'quarantined',
    lifecycle_state = 'quarantined',
    quarantined_until = now() + interval '100 years',
    quarantine_reason = 'invalid_client: app credentials rejected by Spotify Accounts API. Removed from rotation in Phase 17-B.6 pre-work (Step A).',
    removed_from_pool_at = now(),
    updated_at = now()
WHERE slug = 'nexengine-09';