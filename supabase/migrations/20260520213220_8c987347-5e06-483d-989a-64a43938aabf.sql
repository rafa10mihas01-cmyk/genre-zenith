-- Novo default: 48h (2 dias)
ALTER TABLE public.curator_deal_songs
  ALTER COLUMN auto_collect_interval_minutes SET DEFAULT 2880;

-- Aplica a deals ativos
UPDATE public.curator_deal_songs s
SET
  auto_collect_interval_minutes = 2880,
  next_auto_collect_at = COALESCE(s.last_auto_collect_at, now()) + interval '2880 minutes'
FROM public.curator_deals d
WHERE s.deal_id = d.id
  AND d.closed_at IS NULL;