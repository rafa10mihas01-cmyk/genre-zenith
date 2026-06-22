
-- Adiciona coluna de pesos (calibração sem código)
ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS engine_priority_weights jsonb NOT NULL DEFAULT jsonb_build_object(
    'spotify_popularity', 0.35,
    'campaign_boost',     1.00,
    'growth',             1.00,
    'release_age',        1.00,
    'artist_score',       1.00,
    'diversity_penalty',  1.00,
    'learning_signal',    1.00
  );

-- Reescreve a função para aplicar pesos calibráveis
CREATE OR REPLACE FUNCTION public.compute_placement_priority(_placement_id uuid)
RETURNS TABLE(score numeric, components jsonb, calculated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_track_id uuid;
  v_playlist_id uuid;
  v_spotify_track_id text;
  v_spotify_artist_id text;
  v_added_at timestamptz;
  v_pop numeric := 0;
  v_release_age_days integer := NULL;
  v_release_age numeric := 0;
  v_campaign_boost numeric := 0;
  v_growth numeric := 0;
  v_artist_score numeric := 0;
  v_diversity_penalty numeric := 0;
  v_learning numeric := 0;
  v_same_artist_count integer := 0;
  v_active_campaign boolean := false;
  v_score numeric := 0;
  v_components jsonb;
  v_now timestamptz := now();
  v_weights jsonb;
  w_pop numeric; w_camp numeric; w_growth numeric; w_age numeric;
  w_artist numeric; w_div numeric; w_learn numeric;
BEGIN
  SELECT engine_priority_weights INTO v_weights FROM public.system_flags ORDER BY id LIMIT 1;
  IF v_weights IS NULL THEN
    v_weights := jsonb_build_object(
      'spotify_popularity',0.35,'campaign_boost',1,'growth',1,
      'release_age',1,'artist_score',1,'diversity_penalty',1,'learning_signal',1);
  END IF;
  w_pop    := COALESCE((v_weights->>'spotify_popularity')::numeric, 0.35);
  w_camp   := COALESCE((v_weights->>'campaign_boost')::numeric, 1);
  w_growth := COALESCE((v_weights->>'growth')::numeric, 1);
  w_age    := COALESCE((v_weights->>'release_age')::numeric, 1);
  w_artist := COALESCE((v_weights->>'artist_score')::numeric, 1);
  w_div    := COALESCE((v_weights->>'diversity_penalty')::numeric, 1);
  w_learn  := COALESCE((v_weights->>'learning_signal')::numeric, 1);

  SELECT cp.catalog_track_id, cp.managed_playlist_id, cp.added_at,
         ct.spotify_track_id, ct.spotify_artist_id
    INTO v_track_id, v_playlist_id, v_added_at, v_spotify_track_id, v_spotify_artist_id
  FROM public.catalog_placements cp
  JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id
  WHERE cp.id = _placement_id;

  IF v_track_id IS NULL THEN
    RETURN QUERY SELECT 0::numeric, jsonb_build_object('error','placement_not_found'), v_now;
    RETURN;
  END IF;

  SELECT COALESCE(stc.popularity, 0) INTO v_pop
  FROM public.spotify_track_cache stc
  WHERE stc.spotify_track_id = v_spotify_track_id LIMIT 1;
  v_pop := COALESCE(v_pop, 0);

  SELECT GREATEST(0, (v_now::date - stc.release_date))::int INTO v_release_age_days
  FROM public.spotify_track_cache stc
  WHERE stc.spotify_track_id = v_spotify_track_id AND stc.release_date IS NOT NULL LIMIT 1;

  IF v_release_age_days IS NOT NULL THEN
    v_release_age := GREATEST(0, 15 * (1 - LEAST(v_release_age_days, 365)::numeric / 365));
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.curator_deal_songs cds
    JOIN public.curator_deals cd ON cd.id = cds.deal_id
    WHERE cds.catalog_track_id = v_track_id
      AND cd.status IN ('active','in_progress','approved','running')
      AND (cd.deadline IS NULL OR cd.deadline >= v_now::date)
  ) INTO v_active_campaign;
  IF v_active_campaign THEN v_campaign_boost := 15; END IF;

  IF v_added_at IS NOT NULL THEN
    v_growth := GREATEST(0, 10 * (1 - LEAST(EXTRACT(EPOCH FROM (v_now - v_added_at))/86400, 14)::numeric / 14));
  END IF;

  v_artist_score := LEAST(10, v_pop / 10.0);

  IF v_spotify_artist_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_same_artist_count
    FROM public.catalog_placements cp2
    JOIN public.catalog_tracks ct2 ON ct2.id = cp2.catalog_track_id
    WHERE cp2.managed_playlist_id = v_playlist_id
      AND cp2.status = 'active'
      AND ct2.spotify_artist_id = v_spotify_artist_id
      AND cp2.id <> _placement_id;
    IF v_same_artist_count > 1 THEN
      v_diversity_penalty := -1 * LEAST(20, (v_same_artist_count - 1) * 4);
    END IF;
  END IF;

  v_learning := 0;

  v_score := (v_pop * w_pop)
           + (v_campaign_boost * w_camp)
           + (v_growth * w_growth)
           + (v_release_age * w_age)
           + (v_artist_score * w_artist)
           + (v_diversity_penalty * w_div)
           + (v_learning * w_learn);

  v_components := jsonb_build_object(
    'raw', jsonb_build_object(
      'spotify_popularity', v_pop,
      'campaign_boost', v_campaign_boost,
      'campaign_active', v_active_campaign,
      'growth', round(v_growth::numeric, 2),
      'release_age_bonus', round(v_release_age::numeric, 2),
      'release_age_days', v_release_age_days,
      'artist_score', round(v_artist_score::numeric, 2),
      'diversity_penalty', v_diversity_penalty,
      'same_artist_count_in_playlist', v_same_artist_count,
      'learning_signal', v_learning
    ),
    'weighted', jsonb_build_object(
      'spotify_popularity', round((v_pop * w_pop)::numeric, 2),
      'campaign_boost',     round((v_campaign_boost * w_camp)::numeric, 2),
      'growth',             round((v_growth * w_growth)::numeric, 2),
      'release_age',        round((v_release_age * w_age)::numeric, 2),
      'artist_score',       round((v_artist_score * w_artist)::numeric, 2),
      'diversity_penalty',  round((v_diversity_penalty * w_div)::numeric, 2),
      'learning_signal',    round((v_learning * w_learn)::numeric, 2)
    ),
    'weights', v_weights
  );

  RETURN QUERY SELECT round(v_score::numeric, 2), v_components, v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_placement_priority(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_placement_priority(uuid) TO service_role, authenticated;
