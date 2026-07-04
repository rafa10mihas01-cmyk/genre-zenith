
-- Coluna de controle de reposicionamento
ALTER TABLE public.catalog_placements
  ADD COLUMN IF NOT EXISTS repositioned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reposition_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reposition_last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_catalog_placements_needs_reposition
  ON public.catalog_placements (managed_playlist_id)
  WHERE status = 'active'
    AND repositioned_at IS NULL
    AND (position IS NULL OR position = 0)
    AND reposition_attempts < 5;

-- RPC que trava atomicamente N placements para reposicionar
CREATE OR REPLACE FUNCTION public.claim_next_catalog_repositions(_worker TEXT, _limit INT)
RETURNS TABLE (
  id UUID,
  catalog_track_id UUID,
  managed_playlist_id UUID,
  attempts INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT cp.id
      FROM public.catalog_placements cp
     WHERE cp.status = 'active'
       AND cp.repositioned_at IS NULL
       AND (cp.position IS NULL OR cp.position = 0)
       AND cp.reposition_attempts < 5
       AND (cp.lease_expires_at IS NULL OR cp.lease_expires_at < now())
     ORDER BY cp.updated_at ASC
     LIMIT _limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.catalog_placements cp
     SET locked_at = now(),
         locked_by = _worker,
         lease_expires_at = now() + interval '5 minutes'
    FROM candidates c
   WHERE cp.id = c.id
  RETURNING cp.id, cp.catalog_track_id, cp.managed_playlist_id, cp.reposition_attempts;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_next_catalog_repositions(TEXT, INT) TO service_role;
