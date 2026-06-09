
-- 1) RLS em notifications_archive_phase1
ALTER TABLE public.notifications_archive_phase1 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own archived notifications" ON public.notifications_archive_phase1;
CREATE POLICY "Users can read own archived notifications"
  ON public.notifications_archive_phase1
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own archived notifications" ON public.notifications_archive_phase1;
CREATE POLICY "Users can update own archived notifications"
  ON public.notifications_archive_phase1
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own archived notifications" ON public.notifications_archive_phase1;
CREATE POLICY "Users can delete own archived notifications"
  ON public.notifications_archive_phase1
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access on notifications archive" ON public.notifications_archive_phase1;
CREATE POLICY "Service role full access on notifications archive"
  ON public.notifications_archive_phase1
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 2) View vw_campaign_playlist_growth deve respeitar policies do chamador
ALTER VIEW public.vw_campaign_playlist_growth SET (security_invoker = true);
