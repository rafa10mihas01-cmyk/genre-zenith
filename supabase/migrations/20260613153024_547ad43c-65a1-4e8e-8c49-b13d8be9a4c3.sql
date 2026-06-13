
-- 1. coluna frozen_reason (rastreabilidade do motivo do congelamento)
ALTER TABLE public.curator_playlists
  ADD COLUMN IF NOT EXISTS frozen_reason text;

UPDATE public.curator_playlists
SET frozen_reason = 'active_campaign'
WHERE frozen_at IS NOT NULL AND frozen_reason IS NULL;

-- 2. archive de curator_deal_plan
CREATE TABLE IF NOT EXISTS public.curator_deal_plan_archive (
  archive_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id uuid NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archive_reason text NOT NULL,
  original_row jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cdpa_original_id ON public.curator_deal_plan_archive(original_id);
CREATE INDEX IF NOT EXISTS idx_cdpa_archived_at ON public.curator_deal_plan_archive(archived_at);

GRANT SELECT ON public.curator_deal_plan_archive TO authenticated;
GRANT ALL ON public.curator_deal_plan_archive TO service_role;

ALTER TABLE public.curator_deal_plan_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Plan archive readable by team" ON public.curator_deal_plan_archive;
CREATE POLICY "Plan archive readable by team"
  ON public.curator_deal_plan_archive
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operador'::app_role)
    OR public.has_role(auth.uid(), 'curador'::app_role)
  );

-- 3. copiar as 165 linhas órfãs
INSERT INTO public.curator_deal_plan_archive (original_id, archive_reason, original_row)
SELECT cdp.id, 'orphan_playlist_non_operational', to_jsonb(cdp.*)
FROM public.curator_deal_plan cdp
WHERE cdp.curator_playlist_id IN (SELECT id FROM public.curator_playlists WHERE frozen_at IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.curator_deal_plan_archive a WHERE a.original_id = cdp.id
  );

-- 4. remover essas 165 linhas de curator_deal_plan
DELETE FROM public.curator_deal_plan
WHERE curator_playlist_id IN (SELECT id FROM public.curator_playlists WHERE frozen_at IS NULL);

-- 5. preservar as 2 curator_playlists ligadas a delivery_proofs (opção c)
UPDATE public.curator_playlists
SET frozen_at = now(), frozen_reason = 'delivery_proof_immutable'
WHERE frozen_at IS NULL
  AND id IN (SELECT DISTINCT playlist_id FROM public.delivery_proofs WHERE playlist_id IS NOT NULL);

-- 6. remover do archive as linhas que acabaram de ser preservadas
DELETE FROM public.curator_playlists_archive
WHERE original_id IN (
  SELECT id FROM public.curator_playlists WHERE frozen_reason = 'delivery_proof_immutable'
);

-- AUDITORIA FINAL PRE-DELETE
DO $$
DECLARE
  v_total int; v_frozen int; v_frozen_active int; v_frozen_proof int;
  v_candidates int; v_archive_total int;
  v_plan_archive int; v_plan_remaining_refs int;
  v_proofs_blocking int;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.curator_playlists;
  SELECT COUNT(*) INTO v_frozen FROM public.curator_playlists WHERE frozen_at IS NOT NULL;
  SELECT COUNT(*) INTO v_frozen_active FROM public.curator_playlists WHERE frozen_reason='active_campaign';
  SELECT COUNT(*) INTO v_frozen_proof FROM public.curator_playlists WHERE frozen_reason='delivery_proof_immutable';
  SELECT COUNT(*) INTO v_candidates FROM public.curator_playlists WHERE frozen_at IS NULL;
  SELECT COUNT(*) INTO v_archive_total FROM public.curator_playlists_archive;
  SELECT COUNT(*) INTO v_plan_archive FROM public.curator_deal_plan_archive;
  SELECT COUNT(*) INTO v_plan_remaining_refs FROM public.curator_deal_plan
    WHERE curator_playlist_id IN (SELECT id FROM public.curator_playlists WHERE frozen_at IS NULL);
  SELECT COUNT(*) INTO v_proofs_blocking FROM public.delivery_proofs
    WHERE playlist_id IN (SELECT id FROM public.curator_playlists WHERE frozen_at IS NULL);

  RAISE NOTICE '===== CHECKPOINT FINAL PRE-DELETE =====';
  RAISE NOTICE 'curator_playlists TOTAL ............... %', v_total;
  RAISE NOTICE 'PRESERVADAS (frozen) .................. %', v_frozen;
  RAISE NOTICE '  active_campaign ..................... %', v_frozen_active;
  RAISE NOTICE '  delivery_proof_immutable ............ %', v_frozen_proof;
  RAISE NOTICE 'A SEREM REMOVIDAS ..................... %', v_candidates;
  RAISE NOTICE 'curator_playlists_archive TOTAL ....... %', v_archive_total;
  RAISE NOTICE 'curator_deal_plan_archive TOTAL ....... %', v_plan_archive;
  RAISE NOTICE '----- FKs RESTANTES (devem ser 0) -----';
  RAISE NOTICE 'curator_deal_plan refs orfas .......... %', v_plan_remaining_refs;
  RAISE NOTICE 'delivery_proofs refs orfas ............ %', v_proofs_blocking;
END $$;
