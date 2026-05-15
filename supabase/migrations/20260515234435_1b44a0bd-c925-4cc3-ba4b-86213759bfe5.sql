
-- =====================================================================
-- A3: Bloquear regressões de plays no ingest de snapshots
-- =====================================================================
-- Spotify nunca diminui play count de uma playlist. Quando isso aparece
-- no histórico (snapshot novo < último snapshot da MESMA playlist no
-- MESMO deal, ambos não-baseline), é erro de OCR/Gemini, screenshot
-- truncado ou recoleta atrasada. Aceitar essas linhas inflama o
-- "delivered" (porque min(baseline) - max(plays) cresce errado quando
-- depois vem um valor real maior). Solução: trigger BEFORE INSERT que
-- detecta regressão e descarta a linha silenciosamente, registrando
-- métrica em collection_logs para auditoria.

CREATE OR REPLACE FUNCTION public.reject_snapshot_regression()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_max BIGINT;
BEGIN
  -- Baseline nunca compara — é a fotografia inicial.
  IF NEW.is_baseline IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Snapshots dependem de (deal_id, playlist_id). Se faltar qualquer um,
  -- não tem como comparar — deixa passar.
  IF NEW.deal_id IS NULL OR NEW.playlist_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT MAX(plays) INTO last_max
  FROM public.curator_deal_snapshots
  WHERE deal_id = NEW.deal_id
    AND playlist_id = NEW.playlist_id
    AND is_baseline = false;

  IF last_max IS NOT NULL AND NEW.plays IS NOT NULL AND NEW.plays < last_max THEN
    -- Loga para auditoria, mas NÃO insere a regressão.
    INSERT INTO public.collection_logs (acao, status, mensagem, payload)
    VALUES (
      'snapshot_regression_blocked',
      'warn',
      format('plays %s < last_max %s', NEW.plays, last_max),
      jsonb_build_object(
        'deal_id', NEW.deal_id,
        'playlist_id', NEW.playlist_id,
        'new_plays', NEW.plays,
        'last_max', last_max,
        'batch_id', NEW.batch_id,
        'source', NEW.source,
        'captured_at', NEW.captured_at
      )
    );
    RETURN NULL; -- BEFORE INSERT retornando NULL → linha descartada
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_snapshot_regression ON public.curator_deal_snapshots;
CREATE TRIGGER trg_reject_snapshot_regression
  BEFORE INSERT ON public.curator_deal_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_snapshot_regression();

-- =====================================================================
-- A4: Recuperar lotes presos em status='processing'
-- =====================================================================
-- A função extract-snapshot-from-print marca o lote como 'processing'
-- assim que entra. Se ela trava (timeout, OOM, Gemini fora) ou crasha
-- antes de marcar 'processed', o lote fica preso pra sempre — porque o
-- cron-recover-print-batches só olhava status='complete'. Aqui:
--   1) Expandimos o recover pra incluir 'processing' parado há > 10min;
--   2) Resetamos status pra 'complete' atomicamente, pra que o guard
--      em extract-snapshot-from-print (que faz skip se já está em
--      processing) não bloqueie o reprocessamento.

CREATE OR REPLACE FUNCTION public.recover_stuck_print_batches()
RETURNS TABLE(batch_id uuid, deal_id uuid, song_id uuid, print_urls jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1) Lotes 'processing' presos há > 10min: reset para 'complete'
  UPDATE public.bot_print_batches
  SET status = 'complete',
      updated_at = now(),
      error = COALESCE(error, '') ||
        CASE WHEN error IS NULL OR error = '' THEN '' ELSE E'\n' END ||
        '[' || now()::text || '] recover: status=processing → complete (reset by recover_stuck_print_batches)'
  WHERE status = 'processing'
    AND processed_at IS NULL
    AND received_parts >= total_parts
    AND updated_at < (now() - interval '10 minutes');

  -- 2) Devolve os candidatos a redispatch (inclui os recém-resetados acima)
  RETURN QUERY
  SELECT b.id, b.deal_id, b.song_id, b.print_urls
  FROM public.bot_print_batches b
  WHERE b.processed_at IS NULL
    AND (
      (b.status = 'complete' AND b.completed_at < (now() - interval '5 minutes'))
      OR (b.status = 'complete' AND b.completed_at IS NULL AND b.updated_at < (now() - interval '5 minutes'))
    )
  ORDER BY b.updated_at ASC NULLS FIRST
  LIMIT 20;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recover_stuck_print_batches() TO service_role;
