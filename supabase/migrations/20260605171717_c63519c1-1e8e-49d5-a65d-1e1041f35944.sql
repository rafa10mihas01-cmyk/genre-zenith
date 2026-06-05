
-- FASE 2: Defesa no banco — baseline_conflict
-- 1. Estende CHECK constraint de status para incluir baseline_conflict
ALTER TABLE public.curator_campaign_playlists
  DROP CONSTRAINT IF EXISTS curator_campaign_playlists_status_check;

ALTER TABLE public.curator_campaign_playlists
  ADD CONSTRAINT curator_campaign_playlists_status_check
  CHECK (status = ANY (ARRAY[
    'pending_match'::text,
    'matched'::text,
    'not_found_yet'::text,
    'baseline_conflict'::text
  ]));

-- 2. Novas colunas auxiliares (nullable, default seguro — não afeta linhas existentes)
ALTER TABLE public.curator_campaign_playlists
  ADD COLUMN IF NOT EXISTS baseline_conflict_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS baseline_conflict_source TEXT,
  ADD COLUMN IF NOT EXISTS excluded_from_kpis BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ccp_baseline_conflict
  ON public.curator_campaign_playlists (campaign_id)
  WHERE status = 'baseline_conflict';

-- 3. Atualiza trigger: se playlist já existe na baseline da campanha,
--    marca como baseline_conflict em vez de matched.
CREATE OR REPLACE FUNCTION public.tg_ccp_match_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id UUID;
  v_captured_at TIMESTAMPTZ;
  v_is_baseline BOOLEAN;
BEGIN
  IF NEW.status <> 'pending_match' THEN
    RETURN NEW;
  END IF;

  SELECT collection_run_id, captured_at, COALESCE(is_baseline, false)
    INTO v_run_id, v_captured_at, v_is_baseline
    FROM public.campaign_playlist_collections
   WHERE campaign_id = NEW.campaign_id
     AND playlist_id = NEW.playlist_id
   ORDER BY captured_at ASC
   LIMIT 1;

  IF v_run_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Nova regra: se a primeira coleta veio da baseline (música já existia
  -- na playlist antes da campanha), classificar como baseline_conflict.
  IF v_is_baseline THEN
    NEW.status := 'baseline_conflict';
    NEW.matched_at := NULL;
    NEW.first_seen_collection_run_id := v_run_id;
    NEW.baseline_conflict_at := now();
    NEW.baseline_conflict_source := 'trigger_match_on_insert';
    NEW.excluded_from_kpis := true;
  ELSE
    NEW.status := 'matched';
    NEW.matched_at := v_captured_at;
    NEW.first_seen_collection_run_id := v_run_id;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON COLUMN public.curator_campaign_playlists.excluded_from_kpis IS
  'Quando true, a playlist não conta como entrega válida — usado para baseline_conflict.';
COMMENT ON COLUMN public.curator_campaign_playlists.baseline_conflict_at IS
  'Quando a playlist foi classificada como conflito de baseline (música já existia antes da campanha).';
COMMENT ON COLUMN public.curator_campaign_playlists.baseline_conflict_source IS
  'Origem da classificação: trigger_match_on_insert | register_curator_playlist | manual_reclassification.';
