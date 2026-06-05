
-- Patch B v2 — Fase 1: Recuperar 576 ghosts 🟢 seguros (cross-deal twins)
-- 1) Tabela staging com cohort + 2) backup before/after + 3) função de auditoria

CREATE TABLE IF NOT EXISTS public.patch_b_v2_green_cohort (
  ghost_id uuid PRIMARY KEY,
  twin_pid text NOT NULL
);
GRANT ALL ON public.patch_b_v2_green_cohort TO service_role;
ALTER TABLE public.patch_b_v2_green_cohort ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON public.patch_b_v2_green_cohort FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Backup completo (snapshot pré-mudança) das 576 linhas
CREATE TABLE IF NOT EXISTS public.patch_b_v2_backup_curator_playlists (
  id uuid PRIMARY KEY,
  deal_id uuid,
  playlist_name text,
  spotify_playlist_id text,
  spotify_url text,
  spotify_owner_id text,
  spotify_owner_name text,
  image_url text,
  streams_total bigint,
  streams_7d bigint,
  streams_28d bigint,
  attribution_method text,
  attribution_reason text,
  twin_pid_applied text,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.patch_b_v2_backup_curator_playlists TO service_role;
ALTER TABLE public.patch_b_v2_backup_curator_playlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON public.patch_b_v2_backup_curator_playlists FOR ALL TO service_role USING (true) WITH CHECK (true);
