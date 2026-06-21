
-- Snapshot dos caps antes da alteração (para auditoria/rollback)
CREATE TABLE IF NOT EXISTS public._spotify_apps_caps_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  app_id uuid NOT NULL,
  app_name text NOT NULL,
  lifecycle_state text,
  max_accounts int,
  max_playlists int,
  soft_capacity_cap int
);
GRANT SELECT ON public._spotify_apps_caps_snapshots TO authenticated;
GRANT ALL ON public._spotify_apps_caps_snapshots TO service_role;
ALTER TABLE public._spotify_apps_caps_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read snapshots" ON public._spotify_apps_caps_snapshots
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public._spotify_apps_caps_snapshots
  (reason, app_id, app_name, lifecycle_state, max_accounts, max_playlists, soft_capacity_cap)
SELECT 'pre-balance-recalibration-2026-06-21', id, name, lifecycle_state, max_accounts, max_playlists, soft_capacity_cap
FROM public.spotify_apps;

-- Recalibração dos caps APENAS para Apps ativos
UPDATE public.spotify_apps
SET max_accounts = 25,
    max_playlists = 500,
    soft_capacity_cap = 80,  -- mantém score % próximo da escala atual
    updated_at = now()
WHERE lifecycle_state = 'active';
