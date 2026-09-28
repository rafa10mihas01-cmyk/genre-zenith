-- 3) Pausa por conta Spotify (ex.: sem Premium). Não apaga nada; só impede tentativas automáticas.
CREATE TABLE IF NOT EXISTS public.spotify_account_pauses (
  spotify_user_id text PRIMARY KEY,
  reason text NOT NULL,
  paused_until timestamptz NOT NULL,
  last_error text,
  paused_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.spotify_account_pauses TO authenticated;
GRANT ALL ON public.spotify_account_pauses TO service_role;
ALTER TABLE public.spotify_account_pauses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team reads account pauses" ON public.spotify_account_pauses FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operador'));

CREATE OR REPLACE FUNCTION public.is_spotify_account_paused(_uid text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.spotify_account_pauses WHERE spotify_user_id=_uid AND paused_until > now())
$$;

-- 2) Reserva de cota: parte fixa dos limites EXISTENTES é da Campanha/Manual; o resto é do Catálogo. Totais não mudam.
ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS campaign_reserved_daily_global integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS campaign_reserved_daily_per_owner integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS campaign_reserved_daily_per_app integer NOT NULL DEFAULT 200;

-- Contador: envios não-CATALOG vão para escopos CAMPAIGN_*; CATALOG continua nos escopos atuais.
CREATE OR REPLACE FUNCTION public.trg_bump_catalog_counters()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_day date; v_owner text; v_app text; v_origin text; v_pre text;
BEGIN
  IF NEW.outcome NOT IN ('active','success') THEN RETURN NEW; END IF;
  v_day := (COALESCE(NEW.executed_at, now()) AT TIME ZONE 'America/Sao_Paulo')::date;

  SELECT origin INTO v_origin FROM public.catalog_placements WHERE id = NEW.placement_id;
  v_pre := CASE WHEN COALESCE(v_origin,'CATALOG') = 'CATALOG' THEN '' ELSE 'CAMPAIGN_' END;

  SELECT mp.owner_spotify_user_id, sut.app_id::text INTO v_owner, v_app
  FROM public.managed_playlists mp
  LEFT JOIN public.spotify_user_tokens sut
    ON sut.spotify_user_id = mp.owner_spotify_user_id
   AND sut.refresh_token IS NOT NULL AND sut.refresh_token <> ''
  WHERE mp.id = NEW.managed_playlist_id LIMIT 1;

  INSERT INTO public.catalog_distribution_counters(day, scope, scope_id, count, updated_at)
  VALUES (v_day, v_pre||'GLOBAL', '', 1, now())
  ON CONFLICT (day, scope, scope_id) DO UPDATE SET count = catalog_distribution_counters.count + 1, updated_at = now();

  IF v_owner IS NOT NULL AND v_owner <> '' THEN
    INSERT INTO public.catalog_distribution_counters(day, scope, scope_id, count, updated_at)
    VALUES (v_day, v_pre||'OWNER', v_owner, 1, now())
    ON CONFLICT (day, scope, scope_id) DO UPDATE SET count = catalog_distribution_counters.count + 1, updated_at = now();
  END IF;

  IF v_app IS NOT NULL AND v_app <> '' THEN
    INSERT INTO public.catalog_distribution_counters(day, scope, scope_id, count, updated_at)
    VALUES (v_day, v_pre||'APP', v_app, 1, now())
    ON CONFLICT (day, scope, scope_id) DO UPDATE SET count = catalog_distribution_counters.count + 1, updated_at = now();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_next_catalog_placements(_worker text, _limit integer DEFAULT 50)
 RETURNS SETOF catalog_placements LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_today date;
  v_max_global integer; v_max_owner integer; v_max_app integer;
  v_res_global integer; v_res_owner integer; v_res_app integer;
  v_cat_global integer; v_cat_owner integer; v_cat_app integer;
  v_done_cat integer; v_done_camp integer;
  v_rem_cat integer; v_rem_camp integer;
  v_effective integer;
BEGIN
  PERFORM public.fn_sanitize_catalog_pending(2000);

  SELECT COALESCE(catalog_max_daily_distributions, 400), COALESCE(catalog_max_daily_per_owner, 300), COALESCE(catalog_max_daily_per_app, 800),
         COALESCE(campaign_reserved_daily_global, 0), COALESCE(campaign_reserved_daily_per_owner, 0), COALESCE(campaign_reserved_daily_per_app, 0)
    INTO v_max_global, v_max_owner, v_max_app, v_res_global, v_res_owner, v_res_app
  FROM public.system_flags ORDER BY id LIMIT 1;

  -- Partição dos limites existentes (soma = limite atual)
  v_res_global := LEAST(v_res_global, v_max_global);
  v_res_owner  := LEAST(v_res_owner,  v_max_owner);
  v_res_app    := LEAST(v_res_app,    v_max_app);
  v_cat_global := v_max_global - v_res_global;
  v_cat_owner  := v_max_owner  - v_res_owner;
  v_cat_app    := v_max_app    - v_res_app;

  v_today := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  SELECT COALESCE(max(count) FILTER (WHERE scope='GLOBAL'),0), COALESCE(max(count) FILTER (WHERE scope='CAMPAIGN_GLOBAL'),0)
    INTO v_done_cat, v_done_camp
  FROM public.catalog_distribution_counters
  WHERE day = v_today AND scope IN ('GLOBAL','CAMPAIGN_GLOBAL') AND scope_id = '';

  v_rem_cat  := GREATEST(0, v_cat_global - v_done_cat);
  v_rem_camp := GREATEST(0, v_res_global - v_done_camp);
  IF v_rem_cat + v_rem_camp <= 0 THEN RETURN; END IF;

  v_effective := LEAST(GREATEST(1, _limit), v_rem_cat + v_rem_camp, 500);

  RETURN QUERY
  WITH base AS (
    SELECT cp.id, cp.status AS prev_status, cp.catalog_track_id, cp.priority, cp.scheduled_for, cp.created_at,
           (cp.origin = 'CATALOG') AS is_cat,
           mp.owner_spotify_user_id AS owner_id, sut.app_id::text AS app_id
    FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    JOIN public.catalog_tracks    ct ON ct.id = cp.catalog_track_id
    JOIN public.spotify_user_tokens sut
      ON sut.spotify_user_id = mp.owner_spotify_user_id
     AND sut.refresh_token IS NOT NULL AND sut.refresh_token <> ''
    WHERE cp.status IN ('pending','retry','waiting_circuit_breaker','skipped')
      AND cp.scheduled_for <= now()
      AND cp.attempts < cp.max_attempts
      AND mp.playlist_type IN ('CAMPAIGN'::public.playlist_type_enum, 'CATALOG'::public.playlist_type_enum)
      AND mp.execution_mode = 'API_READY'::playlist_execution_mode
      AND mp.spotify_playlist_id IS NOT NULL AND mp.spotify_playlist_id <> ''
      AND ct.spotify_track_id   IS NOT NULL AND ct.spotify_track_id   <> ''
      AND NOT public.is_spotify_account_paused(mp.owner_spotify_user_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.spotify_circuit_breaker scb
        WHERE scb.app_id = sut.app_id::text AND scb.status = 'open'
          AND (scb.blocked_until IS NULL OR scb.blocked_until > now())
      )
  ),
  enriched AS (
    SELECT b.*,
      COALESCE(co.count, 0) AS owner_count_today,
      COALESCE(ca.count, 0) AS app_count_today
    FROM base b
    LEFT JOIN public.catalog_distribution_counters co
      ON co.day = v_today AND co.scope = CASE WHEN b.is_cat THEN 'OWNER' ELSE 'CAMPAIGN_OWNER' END AND co.scope_id = b.owner_id
    LEFT JOIN public.catalog_distribution_counters ca
      ON ca.day = v_today AND ca.scope = CASE WHEN b.is_cat THEN 'APP' ELSE 'CAMPAIGN_APP' END AND ca.scope_id = b.app_id
    WHERE (b.is_cat AND v_rem_cat > 0 AND COALESCE(co.count,0) < v_cat_owner AND COALESCE(ca.count,0) < v_cat_app)
       OR (NOT b.is_cat AND v_rem_camp > 0 AND COALESCE(co.count,0) < v_res_owner AND COALESCE(ca.count,0) < v_res_app)
  ),
  ordered AS (
    SELECT e.*,
      ROW_NUMBER() OVER (PARTITION BY e.catalog_track_id ORDER BY e.priority ASC, e.scheduled_for ASC, e.created_at ASC) AS rn_track,
      ROW_NUMBER() OVER (PARTITION BY e.is_cat ORDER BY e.priority ASC, e.scheduled_for ASC, e.created_at ASC) AS rn_flow
    FROM enriched e
  ),
  eligible AS (
    SELECT o.id, o.prev_status
    FROM ordered o
    JOIN public.catalog_placements cp ON cp.id = o.id
    WHERE (o.is_cat AND o.rn_flow <= v_rem_cat) OR (NOT o.is_cat AND o.rn_flow <= v_rem_camp)
    ORDER BY o.priority ASC, o.rn_track ASC, o.owner_count_today ASC, o.app_count_today ASC, o.scheduled_for ASC, o.created_at ASC
    LIMIT v_effective
    FOR UPDATE OF cp SKIP LOCKED
  )
  UPDATE public.catalog_placements p
  SET status = 'processing', locked_at = now(), locked_by = _worker,
      lease_expires_at = now() + interval '2 minutes',
      attempts = CASE WHEN eligible.prev_status IN ('waiting_circuit_breaker','skipped') THEN p.attempts ELSE p.attempts + 1 END
  FROM eligible
  WHERE p.id = eligible.id
  RETURNING p.*;
END;
$function$;