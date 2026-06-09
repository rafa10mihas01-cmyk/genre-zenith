
DROP FUNCTION IF EXISTS public.claim_collect_queue(integer, integer);

-- Claim atômico por lista de IDs: a edge segue fazendo SELECT+filtros (whitelist,
-- pausa, token), mas a reserva final passa por aqui. Só rows ainda em idle/error
-- são claimed; rows que outro worker já reservou são silenciosamente ignoradas.
CREATE OR REPLACE FUNCTION public.claim_collect_queue(p_ids uuid[])
RETURNS TABLE(id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH locked AS (
    SELECT s.id
    FROM public.curator_deal_songs s
    WHERE s.id = ANY(p_ids)
      AND s.auto_collect_status IN ('idle', 'error')
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.curator_deal_songs s
  SET auto_collect_status = 'queued',
      auto_collect_error = 'Entregue ao robô; aguardando print/snapshot',
      queued_at = now(),
      updated_at = now()
  FROM locked
  WHERE s.id = locked.id
  RETURNING s.id;
$$;

REVOKE ALL ON FUNCTION public.claim_collect_queue(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_collect_queue(uuid[]) TO service_role;

COMMENT ON FUNCTION public.claim_collect_queue(uuid[]) IS
'Claim atômico: recebe IDs candidatos, trava com SKIP LOCKED, atualiza para queued apenas os ainda em idle/error e retorna os IDs efetivamente reservados. Elimina race entre workers paralelos do VPS.';
