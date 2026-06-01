-- 1) Permitir null em baseline_plays (campanhas via planilha não têm valor individual por curador)
ALTER TABLE public.curator_deals ALTER COLUMN baseline_plays DROP NOT NULL;

-- 2) Backfill: propaga baseline_captured_at das campanhas spreadsheet pra deals órfãos
UPDATE public.curator_deals d
   SET baseline_captured_at = c.baseline_captured_at,
       baseline_plays = NULL,
       state = 'collecting'
  FROM public.campaigns c
 WHERE d.campaign_id = c.id
   AND c.collection_mode = 'spreadsheet'
   AND c.baseline_captured_at IS NOT NULL
   AND d.baseline_captured_at IS NULL
   AND (d.source IS NULL OR d.source <> 'campaign_internal');