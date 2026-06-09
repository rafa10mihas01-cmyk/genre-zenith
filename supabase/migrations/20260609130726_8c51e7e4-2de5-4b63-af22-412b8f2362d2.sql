
-- claim_collect_queue: claim atômico de músicas pra coleta pelo bot da VPS.
-- Resolve race condition entre workers paralelos (w0, w1, ...) que liam a mesma
-- row 'idle' antes do UPDATE para 'queued', gerando 2 dispatches → 2 prints.
-- Usa FOR UPDATE SKIP LOCKED para que cada row só seja claimed por um caller.
CREATE OR REPLACE FUNCTION public.claim_collect_queue(
  p_limit integer,
  p_overfetch integer DEFAULT NULL
)
RETURNS SETOF public.curator_deal_songs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(LEAST(p_limit, 20), 1);
  v_overfetch integer := COALESCE(p_overfetch, GREATEST(v_limit * 5, 10));
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT s.id
    FROM public.curator_deal_songs s
    JOIN public.curator_deals d ON d.id = s.deal_id
    LEFT JOIN public.curators c ON c.id = d.curator_id
    WHERE s.auto_collect = true
      AND s.auto_collect_status IN ('idle', 'error')
      AND d.closed_at IS NULL
      AND d.token_revoked_at IS NULL
      AND d.state IN ('awaiting_playlists', 'collecting', 'active')
      AND c.paused_at IS NULL
      AND (d.token_expires_at IS NULL OR d.token_expires_at > now())
      AND (s.next_auto_collect_at IS NULL OR s.next_auto_collect_at <= now())
    ORDER BY s.next_auto_collect_at ASC NULLS FIRST
    LIMIT v_overfetch
    FOR UPDATE OF s SKIP LOCKED
  ),
  picked AS (
    SELECT id FROM candidates LIMIT v_limit
  ),
  claimed AS (
    UPDATE public.curator_deal_songs s
    SET auto_collect_status = 'queued',
        auto_collect_error = 'Entregue ao robô; aguardando print/snapshot',
        queued_at = now(),
        updated_at = now()
    WHERE s.id IN (SELECT id FROM picked)
    RETURNING s.*
  )
  SELECT * FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_collect_queue(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_collect_queue(integer, integer) TO service_role;

COMMENT ON FUNCTION public.claim_collect_queue(integer, integer) IS
'Claim atômico das próximas músicas pra coleta. Usa FOR UPDATE SKIP LOCKED + UPDATE em CTE pra garantir que cada row só seja entregue a um worker, mesmo com chamadas concorrentes do VPS.';
