CREATE OR REPLACE FUNCTION public.quarantine_spotify_app_dev_mode(
  p_app_id uuid,
  p_spotify_user_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app_name text;
  v_already_blocked boolean;
  v_dedupe text;
BEGIN
  IF p_app_id IS NULL THEN RETURN; END IF;

  SELECT name,
         (status = 'quarantined' AND quarantine_reason LIKE 'development_mode_blocked%')
    INTO v_app_name, v_already_blocked
  FROM public.spotify_apps WHERE id = p_app_id;

  IF v_app_name IS NULL THEN RETURN; END IF;

  IF NOT COALESCE(v_already_blocked, false) THEN
    UPDATE public.spotify_apps
       SET status = 'quarantined',
           quarantine_reason = 'development_mode_blocked'
             || COALESCE(': user=' || p_spotify_user_id, ''),
           quarantined_until = now() + interval '100 years',
           updated_at = now()
     WHERE id = p_app_id;
  END IF;

  v_dedupe := 'spotify_app_dev_mode:' || p_app_id::text;
  IF NOT EXISTS (SELECT 1 FROM public.system_alerts WHERE dedupe_key = v_dedupe) THEN
    INSERT INTO public.system_alerts (severity, subsystem, title, message, dedupe_key, metadata)
    VALUES (
      'critical',
      'spotify_apps',
      'App Spotify em Development Mode: ' || v_app_name,
      'A App "' || v_app_name || '" está em Development Mode. Usuário ' ||
        COALESCE(p_spotify_user_id, '?') ||
        ' não está na whitelist do Spotify Developer Dashboard. App removida do balanceador até regularização.',
      v_dedupe,
      jsonb_build_object(
        'app_id', p_app_id,
        'app_name', v_app_name,
        'spotify_user_id', p_spotify_user_id,
        'reason', 'development_mode_blocked'
      )
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.quarantine_spotify_app_dev_mode(uuid, text) TO authenticated, service_role;

SELECT public.quarantine_spotify_app_dev_mode(
  '20c9751d-2df9-4898-a24d-a89e96e1713e'::uuid, 'z4ox6sjcnfkjulzdqkwj6qcd0'
);
SELECT public.quarantine_spotify_app_dev_mode(
  'e9a23b28-a4cf-4386-ba26-7277f870952a'::uuid, 'kondzilla'
);