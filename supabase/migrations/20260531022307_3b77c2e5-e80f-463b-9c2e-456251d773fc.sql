UPDATE public.curator_deal_songs
SET next_auto_collect_at = now(),
    auto_collect_status = 'idle',
    auto_collect_error = NULL
WHERE auto_collect = true
  AND auto_collect_status = 'error';