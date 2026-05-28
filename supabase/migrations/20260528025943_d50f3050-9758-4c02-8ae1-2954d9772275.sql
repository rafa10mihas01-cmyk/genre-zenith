-- 1) pricing_settings — restringir policies ao role 'authenticated'
DROP POLICY IF EXISTS "Owner reads pricing"   ON public.pricing_settings;
DROP POLICY IF EXISTS "Owner inserts pricing" ON public.pricing_settings;
DROP POLICY IF EXISTS "Owner updates pricing" ON public.pricing_settings;
DROP POLICY IF EXISTS "Owner deletes pricing" ON public.pricing_settings;

CREATE POLICY "Owner reads pricing"   ON public.pricing_settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owner inserts pricing" ON public.pricing_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner updates pricing" ON public.pricing_settings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner deletes pricing" ON public.pricing_settings FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 2) Função de operador interno: admin OU operador (exclui curador)
CREATE OR REPLACE FUNCTION public.is_internal_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'operador'::public.app_role)
    );
$$;

-- 3) notifications — equipe = só admin/operador; usuário continua vendo as próprias
DROP POLICY IF EXISTS notif_select              ON public.notifications;
DROP POLICY IF EXISTS notif_update              ON public.notifications;
DROP POLICY IF EXISTS team_delete_notifications ON public.notifications;
DROP POLICY IF EXISTS team_insert_notifications ON public.notifications;

CREATE POLICY notif_select ON public.notifications
  FOR SELECT TO authenticated
  USING (public.is_internal_operator() OR (user_id IS NOT NULL AND user_id = auth.uid()));

CREATE POLICY notif_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (public.is_internal_operator() OR (user_id IS NOT NULL AND user_id = auth.uid()))
  WITH CHECK (public.is_internal_operator() OR (user_id IS NOT NULL AND user_id = auth.uid()));

CREATE POLICY team_delete_notifications ON public.notifications
  FOR DELETE TO authenticated USING (public.is_internal_operator());

CREATE POLICY team_insert_notifications ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (public.is_internal_operator());

-- 4) autopilot_runs — somente admin/operador
DROP POLICY IF EXISTS team_select_autopilot_runs ON public.autopilot_runs;
DROP POLICY IF EXISTS team_insert_autopilot_runs ON public.autopilot_runs;
DROP POLICY IF EXISTS team_update_autopilot_runs ON public.autopilot_runs;
DROP POLICY IF EXISTS team_delete_autopilot_runs ON public.autopilot_runs;

CREATE POLICY team_select_autopilot_runs ON public.autopilot_runs FOR SELECT TO authenticated USING (public.is_internal_operator());
CREATE POLICY team_insert_autopilot_runs ON public.autopilot_runs FOR INSERT TO authenticated WITH CHECK (public.is_internal_operator());
CREATE POLICY team_update_autopilot_runs ON public.autopilot_runs FOR UPDATE TO authenticated USING (public.is_internal_operator()) WITH CHECK (public.is_internal_operator());
CREATE POLICY team_delete_autopilot_runs ON public.autopilot_runs FOR DELETE TO authenticated USING (public.is_internal_operator());

-- 5) curator_deal_songs — somente admin/operador
DROP POLICY IF EXISTS team_select_curator_deal_songs ON public.curator_deal_songs;
DROP POLICY IF EXISTS team_insert_curator_deal_songs ON public.curator_deal_songs;
DROP POLICY IF EXISTS team_update_curator_deal_songs ON public.curator_deal_songs;
DROP POLICY IF EXISTS team_delete_curator_deal_songs ON public.curator_deal_songs;

CREATE POLICY team_select_curator_deal_songs ON public.curator_deal_songs FOR SELECT TO authenticated USING (public.is_internal_operator());
CREATE POLICY team_insert_curator_deal_songs ON public.curator_deal_songs FOR INSERT TO authenticated WITH CHECK (public.is_internal_operator());
CREATE POLICY team_update_curator_deal_songs ON public.curator_deal_songs FOR UPDATE TO authenticated USING (public.is_internal_operator());
CREATE POLICY team_delete_curator_deal_songs ON public.curator_deal_songs FOR DELETE TO authenticated USING (public.is_internal_operator());

-- 6) playlist_execution_jobs — somente admin/operador
DROP POLICY IF EXISTS team_select_pej ON public.playlist_execution_jobs;
DROP POLICY IF EXISTS team_insert_pej ON public.playlist_execution_jobs;
DROP POLICY IF EXISTS team_update_pej ON public.playlist_execution_jobs;
DROP POLICY IF EXISTS team_delete_pej ON public.playlist_execution_jobs;

CREATE POLICY team_select_pej ON public.playlist_execution_jobs FOR SELECT TO authenticated USING (public.is_internal_operator());
CREATE POLICY team_insert_pej ON public.playlist_execution_jobs FOR INSERT TO authenticated WITH CHECK (public.is_internal_operator());
CREATE POLICY team_update_pej ON public.playlist_execution_jobs FOR UPDATE TO authenticated USING (public.is_internal_operator()) WITH CHECK (public.is_internal_operator());
CREATE POLICY team_delete_pej ON public.playlist_execution_jobs FOR DELETE TO authenticated USING (public.is_internal_operator());

-- 7) bot_events: insert ainda usava has_team_access() → trocar pra is_internal_operator()
DROP POLICY IF EXISTS team_insert_bot_events ON public.bot_events;
CREATE POLICY team_insert_bot_events ON public.bot_events FOR INSERT TO authenticated WITH CHECK (public.is_internal_operator());