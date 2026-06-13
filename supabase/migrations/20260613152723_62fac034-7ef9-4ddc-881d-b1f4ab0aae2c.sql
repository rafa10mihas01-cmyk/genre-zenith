
-- PASSO 1: SCHEMA
ALTER TABLE public.curator_playlists
  ADD COLUMN IF NOT EXISTS frozen_at timestamptz;

CREATE TABLE IF NOT EXISTS public.curator_playlists_archive (
  archive_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id uuid NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archive_reason text NOT NULL,
  original_row jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cpa_original_id ON public.curator_playlists_archive(original_id);
CREATE INDEX IF NOT EXISTS idx_cpa_reason ON public.curator_playlists_archive(archive_reason);
CREATE INDEX IF NOT EXISTS idx_cpa_archived_at ON public.curator_playlists_archive(archived_at);

GRANT SELECT ON public.curator_playlists_archive TO authenticated;
GRANT ALL ON public.curator_playlists_archive TO service_role;

ALTER TABLE public.curator_playlists_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Archive readable by team" ON public.curator_playlists_archive;
CREATE POLICY "Archive readable by team"
  ON public.curator_playlists_archive
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operador'::app_role)
    OR public.has_role(auth.uid(), 'curador'::app_role)
  );

-- PASSO 2: CONGELAR OPERACIONAIS
WITH operational AS (
  SELECT cp.id FROM public.curator_playlists cp
  JOIN public.curator_deals cd ON cd.id = cp.deal_id
  JOIN public.campaigns c ON c.id = cd.campaign_id
  WHERE c.status = 'active'
  UNION
  SELECT cp.id FROM public.curator_playlists cp
  JOIN public.curator_deal_plan cdp ON cdp.curator_playlist_id = cp.id
  JOIN public.curator_deals cd ON cd.id = cdp.deal_id
  JOIN public.campaigns c ON c.id = cd.campaign_id
  WHERE c.status = 'active'
  UNION
  SELECT cp.id FROM public.curator_playlists cp
  JOIN public.delivery_proofs dp ON dp.playlist_id = cp.id
  JOIN public.curator_deals cd ON cd.id = dp.deal_id
  JOIN public.campaigns c ON c.id = cd.campaign_id
  WHERE c.status = 'active'
  UNION
  SELECT cp.id FROM public.curator_playlists cp
  JOIN public.curator_deals cd ON cd.id = cp.deal_id
  JOIN public.campaigns c ON c.id = cd.campaign_id
  JOIN public.curator_campaign_playlists ccp
    ON ccp.playlist_id = cp.spotify_playlist_id AND ccp.campaign_id = c.id
  WHERE c.status = 'active'
)
UPDATE public.curator_playlists cp
SET frozen_at = now()
FROM operational op
WHERE cp.id = op.id AND cp.frozen_at IS NULL;

-- PASSO 3: ARQUIVAR NÃO-OPERACIONAIS (snapshot jsonb completo, sem deletar)
INSERT INTO public.curator_playlists_archive (original_id, archive_reason, original_row)
SELECT
  cp.id,
  CASE
    WHEN cp.spotify_playlist_id IS NULL THEN 'legacy_no_spotify_id'
    ELSE 'non_operational_other'
  END,
  to_jsonb(cp.*)
FROM public.curator_playlists cp
WHERE cp.frozen_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.curator_playlists_archive a WHERE a.original_id = cp.id
  );

-- AUDITORIA PÓS-MIGRAÇÃO
DO $$
DECLARE
  v_total_cp int; v_frozen_cp int; v_unfrozen_cp int;
  v_archive_total int; v_archive_no_id int; v_archive_other int;
  v_plan_refs_orphan int; v_proofs_refs_orphan int;
  v_ccp_refs_orphan int; v_snap_refs_orphan int;
BEGIN
  SELECT COUNT(*) INTO v_total_cp FROM public.curator_playlists;
  SELECT COUNT(*) INTO v_frozen_cp FROM public.curator_playlists WHERE frozen_at IS NOT NULL;
  SELECT COUNT(*) INTO v_unfrozen_cp FROM public.curator_playlists WHERE frozen_at IS NULL;
  SELECT COUNT(*) INTO v_archive_total FROM public.curator_playlists_archive;
  SELECT COUNT(*) INTO v_archive_no_id FROM public.curator_playlists_archive WHERE archive_reason='legacy_no_spotify_id';
  SELECT COUNT(*) INTO v_archive_other FROM public.curator_playlists_archive WHERE archive_reason='non_operational_other';
  SELECT COUNT(*) INTO v_plan_refs_orphan FROM public.curator_deal_plan
    WHERE curator_playlist_id IN (SELECT id FROM public.curator_playlists WHERE frozen_at IS NULL);
  SELECT COUNT(*) INTO v_proofs_refs_orphan FROM public.delivery_proofs
    WHERE playlist_id IN (SELECT id FROM public.curator_playlists WHERE frozen_at IS NULL);

  RAISE NOTICE '===== AUDITORIA POS-MIGRACAO =====';
  RAISE NOTICE 'curator_playlists TOTAL .............. %', v_total_cp;
  RAISE NOTICE 'curator_playlists CONGELADAS ......... %', v_frozen_cp;
  RAISE NOTICE 'curator_playlists CANDIDATAS DELETE .. %', v_unfrozen_cp;
  RAISE NOTICE 'archive TOTAL ........................ %', v_archive_total;
  RAISE NOTICE '  legacy_no_spotify_id ............... %', v_archive_no_id;
  RAISE NOTICE '  non_operational_other .............. %', v_archive_other;
  RAISE NOTICE '----- REFERENCIAS A LINHAS NAO CONGELADAS (tratar no DELETE) -----';
  RAISE NOTICE 'curator_deal_plan refs orfas ......... %', v_plan_refs_orphan;
  RAISE NOTICE 'delivery_proofs refs orfas (imutavel)  %', v_proofs_refs_orphan;
END $$;
