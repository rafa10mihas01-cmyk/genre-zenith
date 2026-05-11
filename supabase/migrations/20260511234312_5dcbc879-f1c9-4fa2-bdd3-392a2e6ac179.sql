-- Fase 3: Account + VPS Orchestration

-- 1. vps_nodes
CREATE TABLE IF NOT EXISTS public.vps_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname text NOT NULL UNIQUE,
  ip inet NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  max_concurrent_sessions smallint NOT NULL DEFAULT 1,
  notes text NULL,
  last_heartbeat_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vps_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_select_vps_nodes ON public.vps_nodes;
DROP POLICY IF EXISTS team_insert_vps_nodes ON public.vps_nodes;
DROP POLICY IF EXISTS team_update_vps_nodes ON public.vps_nodes;
DROP POLICY IF EXISTS team_delete_vps_nodes ON public.vps_nodes;
CREATE POLICY team_select_vps_nodes ON public.vps_nodes FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_vps_nodes ON public.vps_nodes FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_vps_nodes ON public.vps_nodes FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_vps_nodes ON public.vps_nodes FOR DELETE TO authenticated USING (has_team_access());

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_vps_nodes_updated ON public.vps_nodes;
CREATE TRIGGER trg_vps_nodes_updated BEFORE UPDATE ON public.vps_nodes
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.vps_nodes (hostname, ip, status, max_concurrent_sessions)
VALUES ('nexengine-bot-02', '178.156.161.146', 'active', 1)
ON CONFLICT (hostname) DO NOTHING;

-- 2. spotify_accounts
CREATE TABLE IF NOT EXISTS public.spotify_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  vps_node_id uuid NULL REFERENCES public.vps_nodes(id) ON DELETE SET NULL,
  email text NULL,
  display_name text NULL,
  session_file_path text NULL,
  status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','expired','inactive')),
  last_login_at timestamptz NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spotify_accounts_vps ON public.spotify_accounts(vps_node_id);
CREATE INDEX IF NOT EXISTS idx_spotify_accounts_status ON public.spotify_accounts(status);

ALTER TABLE public.spotify_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_select_spotify_accounts ON public.spotify_accounts;
DROP POLICY IF EXISTS team_insert_spotify_accounts ON public.spotify_accounts;
DROP POLICY IF EXISTS team_update_spotify_accounts ON public.spotify_accounts;
DROP POLICY IF EXISTS team_delete_spotify_accounts ON public.spotify_accounts;
CREATE POLICY team_select_spotify_accounts ON public.spotify_accounts FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_spotify_accounts ON public.spotify_accounts FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_spotify_accounts ON public.spotify_accounts FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_spotify_accounts ON public.spotify_accounts FOR DELETE TO authenticated USING (has_team_access());

DROP TRIGGER IF EXISTS trg_spotify_accounts_updated ON public.spotify_accounts;
CREATE TRIGGER trg_spotify_accounts_updated BEFORE UPDATE ON public.spotify_accounts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Trigger: sync cache email/display_name from accounts when null
CREATE OR REPLACE FUNCTION public.spotify_accounts_sync_cache()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.email IS NULL OR NEW.display_name IS NULL THEN
    SELECT
      COALESCE(NEW.email, a.email),
      COALESCE(NEW.display_name, a.display_name)
    INTO NEW.email, NEW.display_name
    FROM public.accounts a WHERE a.id = NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spotify_accounts_sync_cache ON public.spotify_accounts;
CREATE TRIGGER trg_spotify_accounts_sync_cache BEFORE INSERT OR UPDATE ON public.spotify_accounts
FOR EACH ROW EXECUTE FUNCTION public.spotify_accounts_sync_cache();

-- Seed: criar spotify_account para cada account existente, vinculando ao VPS default
INSERT INTO public.spotify_accounts (account_id, vps_node_id, status)
SELECT a.id, (SELECT id FROM public.vps_nodes WHERE hostname = 'nexengine-bot-02'),
       CASE WHEN a.status = 'active' THEN 'active' ELSE 'inactive' END
FROM public.accounts a
ON CONFLICT (account_id) DO NOTHING;

-- 3. View v_playlist_vps_assignment
CREATE OR REPLACE VIEW public.v_playlist_vps_assignment AS
SELECT
  mp.id AS managed_playlist_id,
  mp.spotify_playlist_id,
  mp.canonical_playlist_id,
  a.id AS account_id,
  a.display_name AS account_name,
  sa.id AS spotify_account_id,
  sa.session_file_path,
  sa.status AS account_status,
  v.id AS vps_node_id,
  v.hostname,
  v.ip,
  v.status AS vps_status
FROM public.managed_playlists mp
JOIN public.accounts a          ON a.id  = mp.account_id
JOIN public.spotify_accounts sa ON sa.account_id = a.id
LEFT JOIN public.vps_nodes v    ON v.id  = sa.vps_node_id
WHERE mp.archived_at IS NULL;