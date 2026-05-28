DROP POLICY IF EXISTS "Users view own outreach" ON public.curator_outreach_log;

CREATE POLICY "Internal operators view outreach"
ON public.curator_outreach_log
FOR SELECT
TO authenticated
USING (is_internal_operator());