
CREATE TABLE IF NOT EXISTS public.campaign_external_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  target_streams bigint NOT NULL DEFAULT 0,
  target_cost numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','dispatched','partial','completed','cancelled')),
  confirmed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cep_campaign ON public.campaign_external_packages(campaign_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cep_campaign_draft
  ON public.campaign_external_packages(campaign_id)
  WHERE status = 'draft';

CREATE TABLE IF NOT EXISTS public.campaign_external_package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.campaign_external_packages(id) ON DELETE CASCADE,
  curator_id uuid NOT NULL REFERENCES public.curators(id) ON DELETE CASCADE,
  assigned_streams bigint NOT NULL DEFAULT 0,
  assigned_cost numeric NOT NULL DEFAULT 0,
  cost_per_stream numeric NOT NULL DEFAULT 0.04,
  curator_deal_id uuid REFERENCES public.curator_deals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, curator_id)
);

CREATE INDEX IF NOT EXISTS idx_cepi_package ON public.campaign_external_package_items(package_id);
CREATE INDEX IF NOT EXISTS idx_cepi_curator ON public.campaign_external_package_items(curator_id);

ALTER TABLE public.campaign_external_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_external_package_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_select_cep" ON public.campaign_external_packages;
DROP POLICY IF EXISTS "team_insert_cep" ON public.campaign_external_packages;
DROP POLICY IF EXISTS "team_update_cep" ON public.campaign_external_packages;
DROP POLICY IF EXISTS "team_delete_cep" ON public.campaign_external_packages;
CREATE POLICY "team_select_cep" ON public.campaign_external_packages FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_cep" ON public.campaign_external_packages FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_cep" ON public.campaign_external_packages FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_cep" ON public.campaign_external_packages FOR DELETE TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS "team_select_cepi" ON public.campaign_external_package_items;
DROP POLICY IF EXISTS "team_insert_cepi" ON public.campaign_external_package_items;
DROP POLICY IF EXISTS "team_update_cepi" ON public.campaign_external_package_items;
DROP POLICY IF EXISTS "team_delete_cepi" ON public.campaign_external_package_items;
CREATE POLICY "team_select_cepi" ON public.campaign_external_package_items FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_cepi" ON public.campaign_external_package_items FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_cepi" ON public.campaign_external_package_items FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_cepi" ON public.campaign_external_package_items FOR DELETE TO authenticated USING (public.has_team_access());

DROP TRIGGER IF EXISTS trg_cep_updated ON public.campaign_external_packages;
CREATE TRIGGER trg_cep_updated BEFORE UPDATE ON public.campaign_external_packages FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_cepi_updated ON public.campaign_external_package_items;
CREATE TRIGGER trg_cepi_updated BEFORE UPDATE ON public.campaign_external_package_items FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
