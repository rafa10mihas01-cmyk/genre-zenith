CREATE OR REPLACE FUNCTION public.create_curator_deal_atomic(
  p_deal jsonb,
  p_songs jsonb,
  p_force boolean DEFAULT false,
  p_new_curator jsonb DEFAULT NULL::jsonb,
  p_external_curator_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_deal_id uuid;
  v_dup jsonb;
  v_song jsonb;
  v_song_id uuid;
  v_first_song_target bigint := 0;
  v_first_song_daily bigint := 0;
  v_first_song_url text;
  v_first_song_name text;
  v_first_song_artist text;
  v_first_song_cover text;
  v_first_track_id text;
  v_started_at timestamptz;
  v_ends_at timestamptz;
  v_curator_id uuid;
  v_init_plays bigint := 0;
  v_init_amount numeric := 0;
  v_billing_model text;
  v_monthly_amount numeric;
  v_cycle_months int;
  v_next_invoice timestamptz;
  v_ext record;
  v_ext_email text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF p_songs IS NULL OR jsonb_typeof(p_songs) <> 'array' OR jsonb_array_length(p_songs) = 0 THEN
    RAISE EXCEPTION 'É necessário ao menos uma música' USING ERRCODE = '23514';
  END IF;

  v_curator_id := NULLIF(p_deal->>'curator_id','')::uuid;

  -- Gap 9: promoção automática prospect → curador
  IF p_external_curator_id IS NOT NULL AND v_curator_id IS NULL AND p_new_curator IS NULL THEN
    SELECT * INTO v_ext
      FROM public.external_curators
     WHERE id = p_external_curator_id
       AND user_id = v_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Prospect não encontrado' USING ERRCODE = 'P0002';
    END IF;

    v_ext_email := lower(trim(COALESCE(v_ext.email, '')));

    -- Tenta match por email (contato) primeiro, depois por nome
    IF v_ext_email <> '' THEN
      SELECT id INTO v_curator_id
        FROM public.curators
       WHERE user_id = v_user_id
         AND lower(trim(COALESCE(contact, ''))) = v_ext_email
       LIMIT 1;
    END IF;

    IF v_curator_id IS NULL THEN
      SELECT id INTO v_curator_id
        FROM public.curators
       WHERE user_id = v_user_id
         AND lower(trim(name)) = lower(trim(v_ext.name))
       LIMIT 1;
    END IF;

    -- Se não existe, cria
    IF v_curator_id IS NULL THEN
      INSERT INTO public.curators (
        user_id, name, contact, spotify_owner_url, notes
      ) VALUES (
        v_user_id,
        v_ext.name,
        NULLIF(v_ext.email,''),
        NULLIF(v_ext.spotify_url,''),
        NULLIF(v_ext.notes,'')
      ) RETURNING id INTO v_curator_id;
    END IF;
  END IF;

  IF p_new_curator IS NOT NULL AND jsonb_typeof(p_new_curator) = 'object' THEN
    IF v_curator_id IS NOT NULL THEN
      RAISE EXCEPTION 'curator_id e p_new_curator são mutuamente exclusivos' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(NULLIF(p_new_curator->>'name',''), '') = '' THEN
      RAISE EXCEPTION 'Nome do curador é obrigatório' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.curators (
      user_id, name, contact, spotify_owner_id, spotify_owner_url, notes
    ) VALUES (
      v_user_id,
      p_new_curator->>'name',
      NULLIF(p_new_curator->>'contact',''),
      NULLIF(p_new_curator->>'spotify_owner_id',''),
      NULLIF(p_new_curator->>'spotify_owner_url',''),
      NULLIF(p_new_curator->>'notes','')
    ) RETURNING id INTO v_curator_id;

    v_init_plays  := COALESCE((p_new_curator->>'purchased_plays')::bigint, 0);
    v_init_amount := COALESCE((p_new_curator->>'total_cost')::numeric, 0);
    IF v_init_plays > 0 OR v_init_amount > 0 THEN
      INSERT INTO public.curator_purchases (
        user_id, curator_id, plays_purchased, amount, note
      ) VALUES (
        v_user_id, v_curator_id,
        GREATEST(0, v_init_plays),
        GREATEST(0, v_init_amount),
        'saldo inicial'
      );
    END IF;
  END IF;

  v_song := p_songs->0;
  v_first_song_url   := v_song->>'song_spotify_url';
  v_first_song_name  := v_song->>'song_name';
  v_first_song_artist:= v_song->>'song_artist';
  v_first_song_cover := v_song->>'song_cover_url';
  v_first_track_id   := v_song->>'spotify_track_id';
  v_first_song_target:= COALESCE((v_song->>'target_plays')::bigint, 0);
  v_first_song_daily := COALESCE((v_song->>'daily_goal')::bigint, 0);
  v_started_at := COALESCE(NULLIF(p_deal->>'started_at','')::timestamptz, now());
  v_ends_at    := NULLIF(p_deal->>'ends_at','')::timestamptz;

  v_billing_model := COALESCE(NULLIF(p_deal->>'billing_model',''), 'per_streams');
  IF v_billing_model NOT IN ('per_streams','monthly_retainer') THEN
    RAISE EXCEPTION 'billing_model inválido' USING ERRCODE = '23514';
  END IF;
  v_monthly_amount := NULLIF(p_deal->>'monthly_amount','')::numeric;
  v_cycle_months   := NULLIF(p_deal->>'cycle_months','')::int;

  IF v_billing_model = 'monthly_retainer' THEN
    IF v_monthly_amount IS NULL OR v_monthly_amount <= 0 THEN
      RAISE EXCEPTION 'Valor mensal é obrigatório para curador mensalista' USING ERRCODE = '23514';
    END IF;
    v_next_invoice := v_started_at + INTERVAL '1 month';
  END IF;

  SELECT to_jsonb(array_agg(row_to_json(d)))
    INTO v_dup
    FROM public.detect_duplicate_curator_deal(
      v_user_id,
      v_curator_id,
      p_deal->>'curator_name',
      v_first_track_id,
      v_first_song_url,
      v_started_at,
      v_ends_at
    ) d;

  IF v_dup IS NOT NULL AND jsonb_array_length(v_dup) > 0 AND NOT p_force THEN
    RAISE EXCEPTION 'DUPLICATE_DEAL %', v_dup::text USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.curator_deals (
    user_id, curator_id, curator_name,
    song_spotify_url, song_name, song_artist, song_cover_url,
    target_plays, daily_goal, baseline_plays, cost,
    started_at, ends_at, ramp_up_days,
    billing_model, monthly_amount, cycle_months, next_invoice_at
  ) VALUES (
    v_user_id,
    v_curator_id,
    p_deal->>'curator_name',
    v_first_song_url, v_first_song_name, v_first_song_artist, v_first_song_cover,
    v_first_song_target,
    v_first_song_daily,
    COALESCE((p_deal->>'baseline_plays')::bigint, 0),
    NULLIF(p_deal->>'cost','')::numeric,
    v_started_at, v_ends_at,
    COALESCE((p_deal->>'ramp_up_days')::int, 5),
    v_billing_model, v_monthly_amount, v_cycle_months, v_next_invoice
  ) RETURNING id INTO v_deal_id;

  FOR v_song IN SELECT * FROM jsonb_array_elements(p_songs)
  LOOP
    INSERT INTO public.curator_deal_songs (
      deal_id, song_spotify_url, spotify_track_id,
      song_name, song_artist, artist_candidates, song_cover_url,
      daily_goal, duration_days, target_plays, position,
      started_at, ends_at, ramp_up_days,
      auto_collect, auto_collect_status, auto_collect_interval_minutes,
      next_auto_collect_at,
      client_id, smartlink_url
    ) VALUES (
      v_deal_id,
      v_song->>'song_spotify_url',
      NULLIF(v_song->>'spotify_track_id',''),
      v_song->>'song_name',
      NULLIF(v_song->>'song_artist',''),
      COALESCE(
        (SELECT array_agg(value::text) FROM jsonb_array_elements_text(v_song->'artist_candidates')),
        ARRAY[]::text[]
      ),
      NULLIF(v_song->>'song_cover_url',''),
      COALESCE((v_song->>'daily_goal')::bigint, 0),
      COALESCE((v_song->>'duration_days')::int, 30),
      NULLIF(v_song->>'target_plays','')::bigint,
      COALESCE((v_song->>'position')::int, 0),
      NULLIF(v_song->>'started_at','')::timestamptz,
      NULLIF(v_song->>'ends_at','')::timestamptz,
      COALESCE((v_song->>'ramp_up_days')::int, 5),
      true, 'idle', 1440, now(),
      NULLIF(v_song->>'client_id','')::uuid,
      NULLIF(v_song->>'smartlink_url','')
    ) RETURNING id INTO v_song_id;
  END LOOP;

  -- Gap 9: marca prospect como fechado
  IF p_external_curator_id IS NOT NULL THEN
    UPDATE public.external_curators
       SET pipeline_status = 'fechado',
           status = 'fechado',
           updated_at = now()
     WHERE id = p_external_curator_id
       AND user_id = v_user_id;
  END IF;

  PERFORM public.recompute_curator_deal_state(v_deal_id);

  RETURN jsonb_build_object(
    'ok', true,
    'deal_id', v_deal_id,
    'curator_id', v_curator_id,
    'duplicate_warning', v_dup
  );
END;
$function$;