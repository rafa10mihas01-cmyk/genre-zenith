
-- Fase 6: Playlist Valuation

CREATE OR REPLACE FUNCTION public.evaluate_playlist(p_spotify_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mp record;
  v_lib record;
  v_canonical uuid;
  v_followers bigint := 0;
  v_genre uuid;
  v_name text;
  v_cover text;
  v_source text := 'unknown';
  v_capacity numeric := 0;
  v_delivery numeric := 0;
  v_health numeric := 0;
  v_risk numeric := 50;
  v_activity numeric := 0;
  v_followers_norm numeric := 0;
  v_score numeric := 0;
  v_recommendation text;
  v_est_plays bigint := 0;
  v_avg_daily numeric := 0;
  v_campaigns_count integer := 0;
  v_fulfillment numeric := 0;
  v_risk_level text;
  v_growth text;
  v_similar jsonb := '[]'::jsonb;
BEGIN
  -- Try managed_playlists first
  SELECT mp.id, mp.canonical_playlist_id, mp.followers, mp.genre_id, mp.name, mp.cover_url
    INTO v_mp
  FROM managed_playlists mp
  WHERE mp.spotify_playlist_id = p_spotify_id
  LIMIT 1;

  IF FOUND THEN
    v_source := 'managed';
    v_canonical := v_mp.canonical_playlist_id;
    v_followers := COALESCE(v_mp.followers, 0);
    v_genre := v_mp.genre_id;
    v_name := v_mp.name;
    v_cover := v_mp.cover_url;
  ELSE
    SELECT cl.playlist_name, cl.followers, cl.image_url
      INTO v_lib
    FROM curator_playlist_library cl
    WHERE cl.spotify_playlist_id = p_spotify_id
    LIMIT 1;

    IF FOUND THEN
      v_source := 'external_library';
      v_followers := COALESCE(v_lib.followers, 0);
      v_name := v_lib.playlist_name;
      v_cover := v_lib.image_url;
    ELSE
      RETURN jsonb_build_object(
        'found', false,
        'message', 'Playlist não encontrada no banco. Importe primeiro em Minhas Playlists.'
      );
    END IF;
  END IF;

  -- Scores (if canonical exists)
  IF v_canonical IS NOT NULL THEN
    SELECT
      COALESCE(capacity_score, 0),
      COALESCE(delivery_score, 0),
      COALESCE(health_score, 0),
      COALESCE(risk_score, 50),
      COALESCE(activity_score, 0)
      INTO v_capacity, v_delivery, v_health, v_risk, v_activity
    FROM playlist_scores
    WHERE playlist_id = v_canonical
    LIMIT 1;

    SELECT
      COALESCE(campaigns_count, 0),
      COALESCE(fulfillment_rate, 0),
      COALESCE(avg_daily_delivery, 0)
      INTO v_campaigns_count, v_fulfillment, v_avg_daily
    FROM v_playlist_delivery_history
    WHERE playlist_id = v_canonical
    LIMIT 1;
  END IF;

  -- Followers normalized (log scale)
  v_followers_norm := LEAST(100, GREATEST(0, log(GREATEST(v_followers, 1) + 1) * 20));

  -- Composite valuation
  v_score := ROUND(
    0.30 * v_capacity +
    0.25 * v_delivery +
    0.20 * v_health +
    0.15 * v_followers_norm +
    0.10 * (100 - v_risk)
  );
  v_score := GREATEST(0, LEAST(100, v_score));

  v_recommendation := CASE
    WHEN v_score >= 70 THEN 'buy'
    WHEN v_score >= 40 THEN 'maybe'
    ELSE 'skip'
  END;

  -- Estimated monthly plays
  IF v_avg_daily > 0 THEN
    v_est_plays := ROUND(v_avg_daily * 30);
  ELSE
    -- Fallback: capacity * followers * fator
    v_est_plays := ROUND((v_capacity / 100.0) * v_followers * 0.015);
  END IF;

  v_risk_level := CASE
    WHEN v_risk < 30 THEN 'low'
    WHEN v_risk < 60 THEN 'medium'
    ELSE 'high'
  END;

  v_growth := CASE
    WHEN v_followers_norm > v_delivery + 20 THEN 'high'
    WHEN v_followers_norm > v_delivery THEN 'medium'
    ELSE 'low'
  END;

  -- Similar playlists (top 5 by valuation proximity, same genre when possible)
  IF v_canonical IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb) INTO v_similar
    FROM (
      SELECT
        mp.id,
        mp.spotify_playlist_id,
        mp.name,
        mp.cover_url,
        mp.followers,
        ROUND(
          0.30 * COALESCE(ps.capacity_score, 0) +
          0.25 * COALESCE(ps.delivery_score, 0) +
          0.20 * COALESCE(ps.health_score, 0) +
          0.15 * LEAST(100, log(GREATEST(mp.followers, 1) + 1) * 20) +
          0.10 * (100 - COALESCE(ps.risk_score, 50))
        ) AS valuation_score
      FROM managed_playlists mp
      LEFT JOIN playlist_scores ps ON ps.playlist_id = mp.canonical_playlist_id
      WHERE mp.spotify_playlist_id <> p_spotify_id
        AND mp.archived_at IS NULL
        AND (v_genre IS NULL OR mp.genre_id = v_genre)
      ORDER BY ABS(
        ROUND(
          0.30 * COALESCE(ps.capacity_score, 0) +
          0.25 * COALESCE(ps.delivery_score, 0) +
          0.20 * COALESCE(ps.health_score, 0) +
          0.15 * LEAST(100, log(GREATEST(mp.followers, 1) + 1) * 20) +
          0.10 * (100 - COALESCE(ps.risk_score, 50))
        ) - v_score
      )
      LIMIT 5
    ) s;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'spotify_playlist_id', p_spotify_id,
    'name', v_name,
    'cover_url', v_cover,
    'followers', v_followers,
    'data_source', v_source,
    'valuation_score', v_score,
    'recommendation', v_recommendation,
    'estimated_monthly_plays', v_est_plays,
    'risk_level', v_risk_level,
    'growth_potential', v_growth,
    'factors', jsonb_build_object(
      'capacity', v_capacity,
      'delivery', v_delivery,
      'health', v_health,
      'risk', v_risk,
      'activity', v_activity,
      'followers_norm', ROUND(v_followers_norm, 1),
      'campaigns_count', v_campaigns_count,
      'fulfillment_rate', ROUND(v_fulfillment, 1),
      'avg_daily_delivery', ROUND(v_avg_daily, 1)
    ),
    'similar_playlists', v_similar
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_playlist_by_url(p_url text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text;
BEGIN
  v_id := (regexp_match(p_url, 'playlist[/:]([a-zA-Z0-9]+)'))[1];
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'message', 'URL inválida. Use um link de playlist do Spotify.');
  END IF;
  RETURN public.evaluate_playlist(v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_playlists_batch(p_spotify_ids text[])
RETURNS TABLE(
  spotify_playlist_id text,
  valuation_score numeric,
  recommendation text,
  estimated_monthly_plays bigint,
  risk_level text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sid AS spotify_playlist_id,
    (r->>'valuation_score')::numeric,
    r->>'recommendation',
    (r->>'estimated_monthly_plays')::bigint,
    r->>'risk_level'
  FROM unnest(p_spotify_ids) AS sid,
       LATERAL public.evaluate_playlist(sid) AS r
  WHERE (r->>'found')::boolean = true;
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_playlist(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_playlist_by_url(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_playlists_batch(text[]) TO authenticated;
