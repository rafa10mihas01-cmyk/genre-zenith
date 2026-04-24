
-- 🔐 Audit #14 F2C: bucket privado para assets de marca
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: somente time autenticado lê/escreve
DROP POLICY IF EXISTS brand_assets_team_read ON storage.objects;
CREATE POLICY brand_assets_team_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'brand-assets' AND public.has_team_access());

DROP POLICY IF EXISTS brand_assets_team_insert ON storage.objects;
CREATE POLICY brand_assets_team_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'brand-assets' AND public.has_team_access());

DROP POLICY IF EXISTS brand_assets_team_update ON storage.objects;
CREATE POLICY brand_assets_team_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'brand-assets' AND public.has_team_access())
  WITH CHECK (bucket_id = 'brand-assets' AND public.has_team_access());

DROP POLICY IF EXISTS brand_assets_team_delete ON storage.objects;
CREATE POLICY brand_assets_team_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'brand-assets' AND public.has_team_access());
