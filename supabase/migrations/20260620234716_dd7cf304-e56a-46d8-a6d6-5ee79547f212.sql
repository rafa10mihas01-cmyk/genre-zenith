UPDATE public.playlist_execution_jobs
SET status='cancelled',
    completed_at=now(),
    claimed_by=NULL,
    claimed_at=NULL,
    lease_expires_at=NULL,
    last_error='INC-002 cleanup: residual claimed job cancelled após correção e redeploy do guard'
WHERE status='claimed' AND attempts >= max_attempts;