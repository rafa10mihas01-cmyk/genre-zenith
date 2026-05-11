-- Helper to increment AI tokens used per user / month atomically.
CREATE OR REPLACE FUNCTION public.bump_ai_quota(
  p_user_id uuid,
  p_month_start date,
  p_tokens bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used bigint;
  v_cap  bigint;
  v_blocked boolean;
BEGIN
  IF p_user_id IS NULL OR p_tokens IS NULL OR p_tokens <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'noop');
  END IF;

  INSERT INTO public.ai_quota_user (user_id, month_start, tokens_used, cap_tokens, blocked)
  VALUES (p_user_id, p_month_start, p_tokens, 5000000, false)
  ON CONFLICT (user_id, month_start)
  DO UPDATE SET
    tokens_used = public.ai_quota_user.tokens_used + EXCLUDED.tokens_used,
    updated_at  = now()
  RETURNING tokens_used, cap_tokens, blocked
  INTO v_used, v_cap, v_blocked;

  RETURN jsonb_build_object(
    'ok', true,
    'tokens_used', v_used,
    'cap_tokens',  v_cap,
    'blocked',     v_blocked,
    'over_cap',    v_used > v_cap
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bump_ai_quota(uuid, date, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_ai_quota(uuid, date, bigint) TO service_role;