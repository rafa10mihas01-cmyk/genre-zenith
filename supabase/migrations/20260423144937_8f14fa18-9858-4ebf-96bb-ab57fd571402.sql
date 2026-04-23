-- Campos de arquivamento
ALTER TABLE public.playlist_templates
  ADD COLUMN IF NOT EXISTS archived_reason text,
  ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;

-- Índice pra acelerar expiração e ranking
CREATE INDEX IF NOT EXISTS idx_playlist_templates_tier_scored
  ON public.playlist_templates (quality_tier, scored_at);

CREATE INDEX IF NOT EXISTS idx_playlist_templates_status_score
  ON public.playlist_templates (status, final_score DESC);

-- Função: expira templates medium não usados em 72h
CREATE OR REPLACE FUNCTION public.expire_stale_medium_templates(p_hours integer DEFAULT 72)
RETURNS TABLE(expired_count integer, expired_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  WITH expired AS (
    UPDATE public.playlist_templates
    SET status = 'archived',
        quality_tier = 'archived',
        archived_at = now(),
        archived_reason = 'expired_unused',
        updated_at = now()
    WHERE quality_tier = 'medium'
      AND status IN ('pending', 'approved')
      AND spotify_playlist_id IS NULL
      AND scored_at IS NOT NULL
      AND scored_at < now() - make_interval(hours => p_hours)
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM expired;

  RETURN QUERY SELECT COALESCE(array_length(v_ids, 1), 0), COALESCE(v_ids, ARRAY[]::uuid[]);
END;
$$;