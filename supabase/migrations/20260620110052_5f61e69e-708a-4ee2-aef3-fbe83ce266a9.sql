DROP FUNCTION IF EXISTS public.force_close_spotify_circuit_breaker(text, text);
DROP FUNCTION IF EXISTS public.force_close_spotify_circuit_breaker(text);

CREATE FUNCTION public.force_close_spotify_circuit_breaker(p_app_id text, p_context text DEFAULT 'operation')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_affected int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;
  SELECT public.has_role(v_uid, 'admin'::app_role) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  UPDATE public.spotify_circuit_breaker
     SET status = 'closed',
         blocked_until = now(),
         retry_after_sec = 0,
         updated_at = now()
   WHERE app_id = p_app_id
     AND context = p_context
     AND status = 'open';
  GET DIAGNOSTICS v_affected = ROW_COUNT;

  INSERT INTO public.spotify_circuit_breaker_log (app_id, context, event, blocked_until, retry_after_sec, reason)
  VALUES (p_app_id, p_context, 'force_close', now(), 0, 'admin_reset:' || v_uid::text);

  RETURN jsonb_build_object('ok', true, 'affected', v_affected, 'app_id', p_app_id, 'context', p_context);
END;
$$;

REVOKE ALL ON FUNCTION public.force_close_spotify_circuit_breaker(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.force_close_spotify_circuit_breaker(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.force_close_spotify_circuit_breaker(text, text) TO service_role;