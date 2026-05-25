CREATE POLICY "service_insert_eco"
ON public.campaign_eco_snapshots
FOR INSERT
TO public
WITH CHECK (auth.role() = 'service_role');