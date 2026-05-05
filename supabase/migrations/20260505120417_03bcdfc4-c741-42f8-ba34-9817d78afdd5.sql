REVOKE EXECUTE ON FUNCTION public.recover_stuck_print_batches() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stuck_print_batches() TO service_role;