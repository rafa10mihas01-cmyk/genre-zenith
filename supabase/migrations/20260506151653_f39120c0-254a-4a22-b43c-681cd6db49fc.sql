-- Normalizador de tipo (compatibilidade com call sites antigos)
CREATE OR REPLACE FUNCTION public._normalize_notification_type(p_type text)
RETURNS public.notification_type
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text;
BEGIN
  v := lower(coalesce(p_type, 'info'));
  IF v IN ('error', 'critical', 'fatal', 'high') THEN
    RETURN 'critical'::public.notification_type;
  ELSIF v IN ('warning', 'warn', 'medium') THEN
    RETURN 'warning'::public.notification_type;
  ELSE
    -- success, info, low, debug, qualquer outro → info
    RETURN 'info'::public.notification_type;
  END IF;
END;
$$;

-- Sobrecarga 1: assinatura ANTIGA (mantém compatibilidade total)
-- p_type: notification_type — call sites que passam 'critical'|'warning'|'info'
CREATE OR REPLACE FUNCTION public.create_notification(
  p_type public.notification_type,
  p_title text,
  p_message text,
  p_action_url text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Encaminha para a versão estendida (text) sem dedupe
  v_id := public.create_notification(
    p_type::text,
    p_title,
    p_message,
    p_action_url,
    p_metadata,
    NULL,
    60
  );
  RETURN v_id;
END;
$$;

-- Sobrecarga 2: assinatura ESTENDIDA (text + dedupe)
-- Aceita 'error'/'success'/qualquer valor → normaliza
-- Aceita p_dedupe_key + p_cooldown_minutes para dedupe global
CREATE OR REPLACE FUNCTION public.create_notification(
  p_type text,
  p_title text,
  p_message text,
  p_action_url text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_dedupe_key text DEFAULT NULL,
  p_cooldown_minutes int DEFAULT 60
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_existing_id uuid;
  v_normalized public.notification_type;
  v_metadata jsonb;
  v_dedupe_key text;
  v_cooldown int;
BEGIN
  v_normalized := public._normalize_notification_type(p_type);
  v_metadata := COALESCE(p_metadata, '{}'::jsonb);
  v_cooldown := GREATEST(COALESCE(p_cooldown_minutes, 60), 0);

  -- dedupe_key: prioriza parâmetro, senão pega de metadata.dedupe_key, senão de metadata.kind
  v_dedupe_key := COALESCE(
    p_dedupe_key,
    v_metadata->>'dedupe_key',
    v_metadata->>'kind'
  );

  -- Se houver dedupe_key + cooldown > 0, procura notificação existente
  IF v_dedupe_key IS NOT NULL AND v_cooldown > 0 THEN
    SELECT id INTO v_existing_id
    FROM public.notifications
    WHERE metadata->>'dedupe_key' = v_dedupe_key
      AND created_at > now() - make_interval(mins => v_cooldown)
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- Incrementa contador de ocorrências silenciosamente
      UPDATE public.notifications
      SET metadata = metadata || jsonb_build_object(
            'occurrences', COALESCE((metadata->>'occurrences')::int, 1) + 1,
            'last_seen_at', to_jsonb(now())
          )
      WHERE id = v_existing_id;
      RETURN v_existing_id;
    END IF;
  END IF;

  -- Garante que dedupe_key esteja salvo no metadata (para queries futuras e UI)
  IF v_dedupe_key IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('dedupe_key', v_dedupe_key);
  END IF;

  -- Preserva tipo original se foi normalizado (para auditoria/UI)
  IF lower(p_type) NOT IN ('critical', 'warning', 'info') THEN
    v_metadata := v_metadata || jsonb_build_object('original_type', p_type);
  END IF;

  INSERT INTO public.notifications (type, title, message, action_url, metadata)
  VALUES (v_normalized, p_title, p_message, p_action_url, v_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Índices para dedupe e filtragem por domínio
CREATE INDEX IF NOT EXISTS idx_notifications_dedupe_key
  ON public.notifications ((metadata->>'dedupe_key'))
  WHERE metadata ? 'dedupe_key';

CREATE INDEX IF NOT EXISTS idx_notifications_domain_created
  ON public.notifications ((metadata->>'domain'), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_kind
  ON public.notifications ((metadata->>'kind'))
  WHERE metadata ? 'kind';