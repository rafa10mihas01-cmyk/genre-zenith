-- Recriar community_points_ledger (dropada por engano na migração 20260519012855)
-- As funções community_audit_report, community_member_points, community_review_participation,
-- community_revert_participation e o trigger cpl_block_mutations ainda dependem dela.

CREATE TABLE IF NOT EXISTS public.community_points_ledger (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        uuid NOT NULL,
  participation_id uuid,
  campaign_id      uuid,
  points           integer NOT NULL,
  reason           text NOT NULL,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cpl_member_created
  ON public.community_points_ledger(member_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_cpl_part_reason
  ON public.community_points_ledger(participation_id, reason)
  WHERE participation_id IS NOT NULL;

ALTER TABLE public.community_points_ledger ENABLE ROW LEVEL SECURITY;

-- SELECT: time vê tudo; membro só vê o próprio ledger
DROP POLICY IF EXISTS team_select_cpl ON public.community_points_ledger;
CREATE POLICY team_select_cpl ON public.community_points_ledger
  FOR SELECT TO authenticated
  USING (
    has_team_access()
    OR member_id IN (SELECT id FROM community_members WHERE user_id = auth.uid())
  );

-- Bloqueia INSERT direto pelo cliente (escrita só via SECURITY DEFINER funcs)
DROP POLICY IF EXISTS no_client_write_cpl ON public.community_points_ledger;
CREATE POLICY no_client_write_cpl ON public.community_points_ledger
  FOR INSERT TO authenticated WITH CHECK (false);

-- Trigger: ledger é append-only (bloqueia UPDATE/DELETE)
DROP TRIGGER IF EXISTS trg_cpl_no_update ON public.community_points_ledger;
CREATE TRIGGER trg_cpl_no_update
  BEFORE UPDATE OR DELETE ON public.community_points_ledger
  FOR EACH ROW EXECUTE FUNCTION public.cpl_block_mutations();