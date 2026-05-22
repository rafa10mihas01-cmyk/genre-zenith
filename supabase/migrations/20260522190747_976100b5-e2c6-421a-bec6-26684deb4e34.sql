
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.normalize_playlist_name(text) SET search_path = public;
ALTER FUNCTION public.spotify_app_slugify(text) SET search_path = public, extensions;

-- ai_print_cache: server-only
CREATE POLICY "service_only_ai_print_cache" ON public.ai_print_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- rate_limits: server-only
CREATE POLICY "service_only_rate_limits" ON public.rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);
