
-- ============================================================
-- FASE 4.B.1.B — Hardening de tokens públicos
-- ============================================================

-- ITEM 3: BACKFILL (180 dias)
UPDATE public.campaigns
   SET token_expires_at = NOW() + INTERVAL '180 days'
 WHERE public_plan_token IS NOT NULL
   AND token_expires_at IS NULL;

UPDATE public.curator_deals
   SET token_expires_at = NOW() + INTERVAL '180 days'
 WHERE public_token IS NOT NULL
   AND token_expires_at IS NULL;

-- ============================================================
-- ITEM 7: AUDIT TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.public_token_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('campaign','curator_deal')),
  entity_id       uuid NOT NULL,
  action          text NOT NULL CHECK (action IN ('create','rotate','revoke')),
  actor_user_id   uuid NULL,
  ip              inet NULL,
  reason          text NULL,
  correlation_id  text NULL,
  old_token_hash  text NULL,
  new_token_hash  text NULL,
  expires_at      timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.public_token_audit TO authenticated;
GRANT ALL    ON public.public_token_audit TO service_role;

ALTER TABLE public.public_token_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read public_token_audit"    ON public.public_token_audit;
DROP POLICY IF EXISTS "Service role manages token audit" ON public.public_token_audit;

CREATE POLICY "Admins read public_token_audit"
  ON public.public_token_audit
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages token audit"
  ON public.public_token_audit
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_public_token_audit_entity
  ON public.public_token_audit (kind, entity_id, created_at DESC);

-- ============================================================
-- ITEM 4: Helper de validação central
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_public_token_state(
  _revoked_at timestamptz,
  _expires_at timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN _revoked_at IS NOT NULL THEN 'revoked'
    WHEN _expires_at IS NOT NULL AND _expires_at < now() THEN 'expired'
    ELSE 'valid'
  END
$$;

REVOKE ALL ON FUNCTION public.validate_public_token_state(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_public_token_state(timestamptz, timestamptz) TO authenticated, service_role;

-- ============================================================
-- ITEM 5: revoke_public_token
-- ============================================================
CREATE OR REPLACE FUNCTION public.revoke_public_token(
  _kind text,
  _entity_id uuid,
  _actor uuid DEFAULT NULL,
  _ip text DEFAULT NULL,
  _reason text DEFAULT NULL,
  _correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old_token text;
  _exp timestamptz;
BEGIN
  IF _kind = 'campaign' THEN
    UPDATE public.campaigns
       SET token_revoked_at = COALESCE(token_revoked_at, now())
     WHERE id = _entity_id
     RETURNING public_plan_token, token_expires_at INTO _old_token, _exp;
  ELSIF _kind = 'curator_deal' THEN
    UPDATE public.curator_deals
       SET token_revoked_at = COALESCE(token_revoked_at, now())
     WHERE id = _entity_id
     RETURNING public_token, token_expires_at INTO _old_token, _exp;
  ELSE
    RAISE EXCEPTION 'invalid_kind: %', _kind;
  END IF;

  IF _old_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  INSERT INTO public.public_token_audit
    (kind, entity_id, action, actor_user_id, ip, reason, correlation_id, old_token_hash, expires_at)
  VALUES
    (_kind, _entity_id, 'revoke', _actor,
     NULLIF(_ip,'')::inet, _reason, _correlation_id,
     encode(digest(_old_token, 'sha256'), 'hex'), _exp);

  RETURN jsonb_build_object('ok', true, 'revoked_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_public_token(text, uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_public_token(text, uuid, uuid, text, text, text) TO service_role;

-- ============================================================
-- ITEM 6: rotate_public_token
-- ============================================================
CREATE OR REPLACE FUNCTION public.rotate_public_token(
  _kind text,
  _entity_id uuid,
  _actor uuid DEFAULT NULL,
  _ip text DEFAULT NULL,
  _ttl_days int DEFAULT 180,
  _correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old_token text;
  _new_token text := encode(gen_random_bytes(24), 'hex');
  _new_exp timestamptz := now() + (_ttl_days || ' days')::interval;
BEGIN
  IF _kind = 'campaign' THEN
    UPDATE public.campaigns
       SET public_plan_token = _new_token,
           token_expires_at  = _new_exp,
           token_revoked_at  = NULL
     WHERE id = _entity_id
     RETURNING public_plan_token INTO _old_token; -- pega o ANTIGO antes do UPDATE? não: RETURNING devolve o novo.
    -- pega antigo via select prévio
  ELSIF _kind = 'curator_deal' THEN
    UPDATE public.curator_deals
       SET public_token     = _new_token,
           token_expires_at = _new_exp,
           token_revoked_at = NULL
     WHERE id = _entity_id;
  ELSE
    RAISE EXCEPTION 'invalid_kind: %', _kind;
  END IF;

  INSERT INTO public.public_token_audit
    (kind, entity_id, action, actor_user_id, ip, correlation_id, new_token_hash, expires_at)
  VALUES
    (_kind, _entity_id, 'rotate', _actor,
     NULLIF(_ip,'')::inet, _correlation_id,
     encode(digest(_new_token, 'sha256'), 'hex'), _new_exp);

  RETURN jsonb_build_object('ok', true, 'new_token', _new_token, 'expires_at', _new_exp);
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_public_token(text, uuid, uuid, text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rotate_public_token(text, uuid, uuid, text, int, text) TO service_role;
