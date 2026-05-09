CREATE OR REPLACE FUNCTION public.recompute_curator_deal_state(p_deal_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_closed_at timestamptz;
  v_closed_status text;
  v_has_curator_pl boolean;
  v_has_snapshot boolean;
  v_new_state text;
  v_old_state text;
BEGIN
  SELECT closed_at, closed_status, state INTO v_closed_at, v_closed_status, v_old_state
    FROM public.curator_deals WHERE id = p_deal_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_closed_at IS NOT NULL THEN
    v_new_state := CASE WHEN v_closed_status = 'completed' THEN 'completed' ELSE 'closed' END;
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM public.curator_playlists
       WHERE deal_id = p_deal_id AND match_status = 'curator'
    ) INTO v_has_curator_pl;

    IF NOT v_has_curator_pl THEN
      v_new_state := 'awaiting_playlists';
    ELSE
      SELECT EXISTS(
        SELECT 1 FROM public.curator_deal_snapshots s
         JOIN public.curator_playlists p ON p.id = s.playlist_id
         WHERE s.deal_id = p_deal_id
           AND p.match_status = 'curator'
           AND s.is_baseline = false
      ) INTO v_has_snapshot;
      v_new_state := CASE WHEN v_has_snapshot THEN 'active' ELSE 'collecting' END;
    END IF;
  END IF;

  UPDATE public.curator_deals
     SET state = v_new_state
   WHERE id = p_deal_id AND state IS DISTINCT FROM v_new_state
     AND state <> 'paused';

  -- Se entrou em "collecting" agora (transição awaiting_playlists -> collecting),
  -- dispara coleta imediata: bot-collect-queue pegará no próximo polling (≤1 min)
  -- sem esperar o cron das 7h. Só mexe em songs auto_collect=true e idle/error.
  IF v_new_state = 'collecting' AND v_old_state IS DISTINCT FROM 'collecting' THEN
    UPDATE public.curator_deal_songs
       SET next_auto_collect_at = now()
     WHERE deal_id = p_deal_id
       AND auto_collect = true
       AND auto_collect_status IN ('idle', 'error')
       AND (next_auto_collect_at IS NULL OR next_auto_collect_at > now());
  END IF;
END;
$function$;