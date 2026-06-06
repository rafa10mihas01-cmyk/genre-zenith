
-- Phase 1 schema: add superseded_by relationship (non-destructive)
ALTER TABLE public.bot_print_batches
  ADD COLUMN IF NOT EXISTS superseded_by uuid NULL REFERENCES public.bot_print_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bot_print_batches_superseded_by
  ON public.bot_print_batches(superseded_by) WHERE superseded_by IS NOT NULL;

COMMENT ON COLUMN public.bot_print_batches.superseded_by IS
  'Quando preenchido, este batch é uma coleta duplicada da mesma execução do bot; o vencedor é o batch referenciado. Nada é apagado — apenas oculto da UI operacional.';

-- Update v_snapshot_prints to hide superseded batches from operational UI.
-- Observational queries can still read bot_print_batches directly.
DROP VIEW IF EXISTS public.v_snapshot_prints;
CREATE VIEW public.v_snapshot_prints
WITH (security_invoker = true)
AS
SELECT b.id AS run_id,
    b.deal_id,
    b.song_id,
    cd.campaign_id,
    b.created_at,
    b.completed_at,
    CASE
        WHEN jsonb_typeof(b.print_urls) = 'array'::text
          THEN ARRAY( SELECT jsonb_array_elements_text(b.print_urls) )
        ELSE ARRAY[]::text[]
    END AS print_urls,
    CASE
        WHEN jsonb_typeof(b.print_urls) = 'array'::text
          THEN jsonb_array_length(b.print_urls)
        ELSE 0
    END AS print_count
FROM public.bot_print_batches b
LEFT JOIN public.curator_deals cd ON cd.id = b.deal_id
WHERE b.superseded_by IS NULL;

GRANT SELECT ON public.v_snapshot_prints TO authenticated, anon, service_role;
