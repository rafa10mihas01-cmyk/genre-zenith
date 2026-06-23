REVOKE ALL ON FUNCTION public.enqueue_catalog_snapshots_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_catalog_snapshots_due() TO service_role;

REVOKE ALL ON FUNCTION public.tg_catalog_snapshot_queue_done_bump_track() FROM PUBLIC, anon, authenticated, service_role;