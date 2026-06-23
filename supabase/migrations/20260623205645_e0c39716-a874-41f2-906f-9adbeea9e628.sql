-- Liberar job preso para nova tentativa (debug catalog scraper)
UPDATE public.catalog_snapshot_queue
SET status='pending', locked_by=NULL, locked_at=NULL, lease_expires_at=NULL,
    attempts=0, last_error=NULL, last_error_at=NULL, scheduled_for=now(), priority=1
WHERE id='d45a90d1-3954-465e-adec-8b6585691bda';