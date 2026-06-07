-- curator_access_otps: explicit restrictive deny for anon + authenticated
CREATE POLICY "deny_anon_curator_access_otps"
  ON public.curator_access_otps AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_authenticated_curator_access_otps"
  ON public.curator_access_otps AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- curator_access_logs: explicit restrictive deny for anon + authenticated
CREATE POLICY "deny_anon_curator_access_logs"
  ON public.curator_access_logs AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_authenticated_curator_access_logs"
  ON public.curator_access_logs AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- playlist_operation_queue: explicit restrictive deny for authenticated
CREATE POLICY "deny_authenticated_playlist_operation_queue"
  ON public.playlist_operation_queue AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);