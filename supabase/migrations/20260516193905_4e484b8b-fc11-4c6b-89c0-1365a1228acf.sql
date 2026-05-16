
DROP POLICY IF EXISTS "auth read sync_log" ON public.sync_log;
CREATE POLICY "Admins can read sync_log"
  ON public.sync_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

ALTER FUNCTION public.bump_ops_thread_last_msg() SET search_path = public;
ALTER FUNCTION public.community_campaigns_touch() SET search_path = public;
ALTER FUNCTION public.community_tier_for(integer) SET search_path = public;
ALTER FUNCTION public.cpl_block_mutations() SET search_path = public;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public;
ALTER FUNCTION public.tg_set_updated_at() SET search_path = public;
