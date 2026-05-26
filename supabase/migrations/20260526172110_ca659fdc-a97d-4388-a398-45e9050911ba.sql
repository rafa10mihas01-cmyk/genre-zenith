CREATE POLICY "Public can read raw_chart_daily"
ON public.raw_chart_daily
FOR SELECT
TO anon
USING (true);