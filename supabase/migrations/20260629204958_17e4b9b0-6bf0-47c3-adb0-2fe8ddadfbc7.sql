WITH src AS (
  SELECT jsonb_array_elements(dom_payload) AS pl
  FROM public.bot_print_batches
  WHERE id = 'e3f7bd3e-b176-48b3-bf52-63db7d0ef346'
),
rows AS (
  SELECT jsonb_build_object(
    'playlist_id', pl->>'spotify_playlist_id',
    'playlist_url', COALESCE(pl->>'spotify_url', 'https://open.spotify.com/playlist/' || (pl->>'spotify_playlist_id')),
    'playlist_name_at_capture', pl->>'playlist_name',
    'plays_7d', GREATEST(0, COALESCE((pl->>'plays_7d')::int, 0)),
    'captured_at', now(),
    'source', 'baseline_recovery_manual'
  ) AS row_obj
  FROM src
  WHERE (pl->>'spotify_playlist_id') IS NOT NULL
    AND length(pl->>'spotify_playlist_id') > 0
)
SELECT public.ingest_campaign_collection_batch(
  p_campaign_id := 'fa6f9eac-c008-4907-892b-b6be488ef1f1'::uuid,
  p_intent := 'baseline',
  p_rows := (SELECT jsonb_agg(row_obj) FROM rows),
  p_snapshot_run_id := NULL,
  p_upload_id := NULL
);

UPDATE public.bot_print_batches
SET status = 'processed', processed_at = now()
WHERE id = 'e3f7bd3e-b176-48b3-bf52-63db7d0ef346';