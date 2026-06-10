-- Fix: organic_plays_snapshots tinha policy RESTRICTIVE ALL bloqueando até admin SELECT.
-- Substituímos por RESTRICTIVE só em INSERT/UPDATE/DELETE, deixando SELECT
-- ser governado pela policy permissiva de admin já existente.
DROP POLICY IF EXISTS "deny_all_organic_plays_snapshots" ON public.organic_plays_snapshots;

CREATE POLICY "deny_writes_organic_plays_snapshots_insert"
  ON public.organic_plays_snapshots AS RESTRICTIVE
  FOR INSERT TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "deny_writes_organic_plays_snapshots_update"
  ON public.organic_plays_snapshots AS RESTRICTIVE
  FOR UPDATE TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_writes_organic_plays_snapshots_delete"
  ON public.organic_plays_snapshots AS RESTRICTIVE
  FOR DELETE TO anon, authenticated
  USING (false);