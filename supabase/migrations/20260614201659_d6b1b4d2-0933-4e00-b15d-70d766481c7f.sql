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
  v_kind text;
BEGIN
  v_metadata := COALESCE(p_metadata, '{}'::jsonb);
  v_kind := COALESCE(v_metadata->>'kind', '');

  IF v_kind = 'spotify_circuit_open' THEN
    v_normalized := 'warning'::public.notification_type;
  ELSE
    v_normalized := public._normalize_notification_type(p_type);
  END IF;

  v_cooldown := GREATEST(COALESCE(p_cooldown_minutes, 60), 0);
  v_dedupe_key := COALESCE(
    p_dedupe_key,
    v_metadata->>'dedupe_key',
    v_metadata->>'kind'
  );

  IF v_dedupe_key IS NOT NULL AND v_cooldown > 0 THEN
    SELECT id INTO v_existing_id
    FROM public.notifications
    WHERE metadata->>'dedupe_key' = v_dedupe_key
      AND created_at > now() - make_interval(mins => v_cooldown)
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.notifications
      SET metadata = metadata || jsonb_build_object(
            'occurrences', COALESCE((metadata->>'occurrences')::int, 1) + 1,
            'last_seen_at', to_jsonb(now())
          ),
          type = CASE
            WHEN COALESCE(metadata->>'kind', '') = 'spotify_circuit_open'
              THEN 'warning'::public.notification_type
            ELSE type
          END
      WHERE id = v_existing_id;
      RETURN v_existing_id;
    END IF;
  END IF;

  IF v_dedupe_key IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('dedupe_key', v_dedupe_key);
  END IF;

  IF lower(p_type) NOT IN ('critical', 'warning', 'info') THEN
    v_metadata := v_metadata || jsonb_build_object('original_type', p_type);
  END IF;

  INSERT INTO public.notifications (type, title, message, action_url, metadata)
  VALUES (v_normalized, p_title, p_message, p_action_url, v_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

UPDATE public.notifications
SET type = 'warning'::public.notification_type,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('reclassified_reason', 'spotify_waiting_for_auto_release')
WHERE status = 'open'
  AND type = 'critical'
  AND metadata->>'kind' = 'spotify_circuit_open';