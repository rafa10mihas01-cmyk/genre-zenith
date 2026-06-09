-- Fase 1 Notificações — Passo 1+2: ciclo de vida + RPCs

-- 1) Colunas de ciclo de vida
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_status_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_status_check
  CHECK (status IN ('open','resolved','dismissed'));

CREATE INDEX IF NOT EXISTS idx_notifications_status_created
  ON public.notifications (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_status_dedupe
  ON public.notifications ((metadata->>'dedupe_key'))
  WHERE status = 'open';

-- 2) RPC: resolver por dedupe_key (fecha incidente quando o problema sumiu)
CREATE OR REPLACE FUNCTION public.resolve_notifications_by_dedupe(
  p_dedupe_key text,
  p_resolution_message text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_dedupe_key IS NULL OR length(trim(p_dedupe_key)) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.notifications
  SET status = 'resolved',
      resolved_at = now(),
      read = true,
      metadata = COALESCE(metadata, '{}'::jsonb)
                 || jsonb_build_object(
                      'resolved_at', now(),
                      'resolution_message', COALESCE(p_resolution_message, 'Incidente resolvido automaticamente.')
                    )
  WHERE status = 'open'
    AND metadata->>'dedupe_key' = p_dedupe_key;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_notifications_by_dedupe(text, text) TO authenticated, service_role;

-- 3) RPC: marcar TODAS notificações abertas como lidas (corrige escopo)
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(
  p_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_count integer;
BEGIN
  v_uid := COALESCE(p_user_id, auth.uid());

  UPDATE public.notifications
  SET read = true
  WHERE read = false
    AND (
      v_uid IS NULL
      OR user_id = v_uid
      OR user_id IS NULL
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid) TO authenticated, service_role;