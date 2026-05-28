
-- 1) Restringe has_team_access() a admin + operador (remove curador).
--    Isso fecha de uma vez os findings de exposição em clients, financeiro,
--    tabelas operacionais e realtime.messages, sem precisar reescrever as 283
--    políticas que já referenciam essa função.
CREATE OR REPLACE FUNCTION public.has_team_access()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'operador'::public.app_role)
    );
$function$;

-- 2) curator_outreach_log: exige role interna no INSERT/UPDATE
DROP POLICY IF EXISTS "Users insert own outreach" ON public.curator_outreach_log;
DROP POLICY IF EXISTS "Users update own outreach" ON public.curator_outreach_log;

CREATE POLICY "Internal users insert own outreach"
  ON public.curator_outreach_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_internal_operator());

CREATE POLICY "Internal users update own outreach"
  ON public.curator_outreach_log
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND public.is_internal_operator())
  WITH CHECK (auth.uid() = user_id AND public.is_internal_operator());
