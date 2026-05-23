
-- 1) community_invites: restringir SELECT a admins ou ao próprio criador do convite
DROP POLICY IF EXISTS "team_select_community_invites" ON public.community_invites;

CREATE POLICY "admins_or_owner_select_community_invites"
ON public.community_invites
FOR SELECT
TO authenticated
USING (is_admin() OR invited_by = auth.uid());

-- 2) curator_outreach_log: trocar role de {public} para {authenticated} (mantém checagem de dono)
DROP POLICY IF EXISTS "Users view own outreach" ON public.curator_outreach_log;
DROP POLICY IF EXISTS "Users insert own outreach" ON public.curator_outreach_log;
DROP POLICY IF EXISTS "Users update own outreach" ON public.curator_outreach_log;

CREATE POLICY "Users view own outreach"
ON public.curator_outreach_log
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own outreach"
ON public.curator_outreach_log
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own outreach"
ON public.curator_outreach_log
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);
