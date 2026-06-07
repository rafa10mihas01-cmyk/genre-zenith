UPDATE public.managed_playlists
SET archived_at = NULL,
    archived_reason = NULL
WHERE archived_reason = 'spotify_401_persistent'
  AND archived_at >= '2026-06-07 00:00:00+00';