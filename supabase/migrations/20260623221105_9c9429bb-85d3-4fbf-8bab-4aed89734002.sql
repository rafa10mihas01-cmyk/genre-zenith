INSERT INTO catalog_snapshot_queue (catalog_track_id, spotify_track_id, reason, priority, status)
SELECT catalog_track_id, spotify_track_id, 'manual_test', 1, 'pending'
FROM catalog_snapshot_queue
WHERE id='d45a90d1-3954-465e-adec-8b6585691bda';