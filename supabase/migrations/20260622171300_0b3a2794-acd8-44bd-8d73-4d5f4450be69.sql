
-- ============================================================
-- FASE 1: Instrumentação do Engine de Catálogo
-- (sem mudança de comportamento, totalmente reversível)
-- ============================================================

-- 1) Coluna origin em catalog_placements
ALTER TABLE public.catalog_placements
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'CATALOG';

ALTER TABLE public.catalog_placements
  DROP CONSTRAINT IF EXISTS catalog_placements_origin_check;

ALTER TABLE public.catalog_placements
  ADD CONSTRAINT catalog_placements_origin_check
  CHECK (origin IN ('CATALOG','CAMPAIGN','MANUAL','IMPORT'));

CREATE INDEX IF NOT EXISTS idx_catalog_placements_origin
  ON public.catalog_placements (origin);

-- Backfill heurístico: tudo que veio com batch é distribuição do catálogo.
-- O default já cobre o resto como CATALOG (assumido até refinarmos por call site).
UPDATE public.catalog_placements
  SET origin = 'CATALOG'
WHERE origin IS NULL;

-- 2) Tabela append-only de auditoria de origem
CREATE TABLE IF NOT EXISTS public.placement_origin_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  placement_id uuid NOT NULL REFERENCES public.catalog_placements(id) ON DELETE CASCADE,
  catalog_track_id uuid,
  managed_playlist_id uuid,
  origin text NOT NULL,
  status_at_insert text,
  priority_at_insert smallint,
  distribution_batch_id uuid,
  request_id text,
  actor text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.placement_origin_log TO authenticated;
GRANT ALL ON public.placement_origin_log TO service_role;

ALTER TABLE public.placement_origin_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team can read placement_origin_log" ON public.placement_origin_log;
CREATE POLICY "team can read placement_origin_log"
  ON public.placement_origin_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role manages placement_origin_log" ON public.placement_origin_log;
CREATE POLICY "service_role manages placement_origin_log"
  ON public.placement_origin_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_placement_origin_log_placement
  ON public.placement_origin_log (placement_id);
CREATE INDEX IF NOT EXISTS idx_placement_origin_log_origin_created
  ON public.placement_origin_log (origin, created_at DESC);

-- 3) Trigger AFTER INSERT em catalog_placements
CREATE OR REPLACE FUNCTION public.log_catalog_placement_origin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.placement_origin_log (
    placement_id,
    catalog_track_id,
    managed_playlist_id,
    origin,
    status_at_insert,
    priority_at_insert,
    distribution_batch_id,
    request_id,
    actor
  ) VALUES (
    NEW.id,
    NEW.catalog_track_id,
    NEW.managed_playlist_id,
    COALESCE(NEW.origin, 'CATALOG'),
    NEW.status,
    NEW.priority,
    NEW.distribution_batch_id,
    NULLIF(current_setting('request.id', true), ''),
    NULLIF(current_setting('request.actor', true), '')
  );
  RETURN NULL; -- AFTER trigger: retorno ignorado
EXCEPTION WHEN OTHERS THEN
  -- Nunca bloquear a gravação do placement por falha de auditoria
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_catalog_placement_origin ON public.catalog_placements;
CREATE TRIGGER trg_log_catalog_placement_origin
  AFTER INSERT ON public.catalog_placements
  FOR EACH ROW
  EXECUTE FUNCTION public.log_catalog_placement_origin();

-- 4) Feature flags do engine em system_flags (singleton, default OFF)
ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS engine_priority_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS engine_reorder_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS engine_occupancy_autofill boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS engine_campaign_promotes boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS engine_editorial_weights boolean NOT NULL DEFAULT false;
