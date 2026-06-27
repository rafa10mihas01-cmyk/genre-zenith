-- 1) Remove bloqueios administrativos baseados em data
DROP INDEX IF EXISTS public.idx_lsu_dedupe;
DROP INDEX IF EXISTS public.uniq_lsu_active_per_day;

-- 2) Remove triggers de supersede por data (conflitam com "1 importação = 1 entrega")
DROP TRIGGER IF EXISTS trg_lsu_supersede_same_day ON public.label_spreadsheet_uploads;
DROP TRIGGER IF EXISTS trg_lsu_backfill_superseded_by ON public.label_spreadsheet_uploads;

-- 3) Recria dedupe SOMENTE por conteúdo, restrito a uploads ativos.
--    Permite reenvio após quarentena/supersede manual, e bloqueia apenas
--    quando o MESMO conteúdo já está ativo no MESMO deal.
DROP INDEX IF EXISTS public.uniq_upload_content_hash_active;
CREATE UNIQUE INDEX uniq_upload_content_hash_active
  ON public.label_spreadsheet_uploads (deal_id, content_hash)
  WHERE status = 'imported'
    AND quarantined_at IS NULL
    AND content_hash IS NOT NULL;