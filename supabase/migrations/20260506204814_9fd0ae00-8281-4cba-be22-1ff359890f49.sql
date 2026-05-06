UPDATE public.curator_deal_songs s
SET auto_collect_interval_minutes = 1,
    next_auto_collect_at = now(),
    updated_at = now()
FROM public.curator_deals d
WHERE d.id = s.deal_id
  AND d.closed_at IS NULL
  AND s.auto_collect = true
  AND s.auto_collect_status IN ('idle', 'error');