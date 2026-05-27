-- 1) bot_events: realtime broadcasts to all team subscribers — restrict to admins only
DROP POLICY IF EXISTS team_select_bot_events ON public.bot_events;
CREATE POLICY admin_select_bot_events
  ON public.bot_events
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS team_delete_bot_events ON public.bot_events;
CREATE POLICY admin_delete_bot_events
  ON public.bot_events
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

CREATE POLICY admin_update_bot_events
  ON public.bot_events
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 2) label_spreadsheet_reminders: explicit service_role-only write policies (documents intent)
CREATE POLICY service_role_write_lsr
  ON public.label_spreadsheet_reminders
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3) playlist_operation_queue: explicit service_role-only write policies (documents intent)
CREATE POLICY service_role_write_poq
  ON public.playlist_operation_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4) campaign_plan_history: explicit service_role-only write policies (documents intent)
CREATE POLICY service_role_write_cph
  ON public.campaign_plan_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
