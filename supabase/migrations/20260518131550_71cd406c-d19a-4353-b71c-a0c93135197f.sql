
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS simulation_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS eco_dispatched_at timestamptz;

CREATE TABLE IF NOT EXISTS public.campaign_eco_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  managed_playlist_id uuid NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  planned_streams bigint NOT NULL DEFAULT 0,
  start_day integer NOT NULL DEFAULT 1,
  dispatched_at timestamptz,
  job_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','dispatched','active','done','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cea_campaign ON public.campaign_eco_allocations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_cea_playlist ON public.campaign_eco_allocations(managed_playlist_id);

ALTER TABLE public.campaign_eco_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_select_cea" ON public.campaign_eco_allocations;
DROP POLICY IF EXISTS "team_insert_cea" ON public.campaign_eco_allocations;
DROP POLICY IF EXISTS "team_update_cea" ON public.campaign_eco_allocations;
DROP POLICY IF EXISTS "team_delete_cea" ON public.campaign_eco_allocations;

CREATE POLICY "team_select_cea" ON public.campaign_eco_allocations FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_cea" ON public.campaign_eco_allocations FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_cea" ON public.campaign_eco_allocations FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_cea" ON public.campaign_eco_allocations FOR DELETE TO authenticated USING (public.has_team_access());

DROP TRIGGER IF EXISTS trg_cea_updated ON public.campaign_eco_allocations;
CREATE TRIGGER trg_cea_updated BEFORE UPDATE ON public.campaign_eco_allocations FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
