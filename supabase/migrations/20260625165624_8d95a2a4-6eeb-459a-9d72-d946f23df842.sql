
-- =========================================================
-- FASE 3 — Occupancy Engine (SHADOW)
-- =========================================================

-- 1) Tabela de planos
CREATE TABLE IF NOT EXISTS public.occupancy_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  managed_playlist_id uuid NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'SHADOW' CHECK (mode IN ('SHADOW','PRIMARY')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','applied','discarded','blocked')),
  block_reason text,
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz
);

GRANT SELECT ON public.occupancy_plans TO authenticated;
GRANT ALL ON public.occupancy_plans TO service_role;

ALTER TABLE public.occupancy_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read occupancy plans"
  ON public.occupancy_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages occupancy plans"
  ON public.occupancy_plans FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_occ_plans_playlist_created
  ON public.occupancy_plans(managed_playlist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_occ_plans_mode_status
  ON public.occupancy_plans(mode, status);

-- 2) Operações do plano
CREATE TABLE IF NOT EXISTS public.occupancy_plan_ops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.occupancy_plans(id) ON DELETE CASCADE,
  op_type text NOT NULL CHECK (op_type IN ('INSERT','REMOVE','REPOSITION','REPLACE')),
  spotify_track_id text,
  classification text CHECK (classification IN ('Campaign','Catalog','ThirdParty')),
  from_position integer,
  to_position integer,
  reason text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.occupancy_plan_ops TO authenticated;
GRANT ALL ON public.occupancy_plan_ops TO service_role;

ALTER TABLE public.occupancy_plan_ops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read occupancy ops"
  ON public.occupancy_plan_ops FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages occupancy ops"
  ON public.occupancy_plan_ops FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_occ_ops_plan ON public.occupancy_plan_ops(plan_id);
CREATE INDEX IF NOT EXISTS idx_occ_ops_type ON public.occupancy_plan_ops(plan_id, op_type);

-- =========================================================
-- 3) RPC principal: fn_playlist_occupancy_rebuild
-- =========================================================
CREATE OR REPLACE FUNCTION public.fn_playlist_occupancy_rebuild(
  p_playlist_id uuid,
  p_mode text DEFAULT 'SHADOW'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
  v_policy record;
  v_policy_src text;
  v_total_current integer := 0;
  v_third_count integer := 0;
  v_third_cap integer := 0;
  v_campaign_count integer := 0;
  v_dup_removed integer := 0;
  v_third_overflow integer := 0;
  v_inserts integer := 0;
  v_repos integer := 0;
  v_top_gaps integer := 0;
BEGIN
  IF p_mode NOT IN ('SHADOW','PRIMARY') THEN
    RAISE EXCEPTION 'invalid mode: %', p_mode;
  END IF;

  -- Resolve política (E5)
  SELECT * INTO v_policy FROM public.fn_resolve_playlist_policy(p_playlist_id);
  IF v_policy IS NULL OR v_policy.managed_playlist_id IS NULL THEN
    RAISE EXCEPTION 'playlist % não encontrada', p_playlist_id;
  END IF;
  v_policy_src := v_policy.source;

  -- Cria plano (mesmo se bloqueado, para rastreabilidade)
  INSERT INTO public.occupancy_plans (managed_playlist_id, mode, status, policy_snapshot)
  VALUES (
    p_playlist_id,
    p_mode,
    CASE WHEN v_policy_src = 'missing' THEN 'blocked' ELSE 'draft' END,
    to_jsonb(v_policy)
  )
  RETURNING id INTO v_plan_id;

  -- E5: bloqueia apenas esta playlist, registra alerta e retorna
  IF v_policy_src = 'missing' THEN
    UPDATE public.occupancy_plans
       SET block_reason = 'policy_missing', finalized_at = now()
     WHERE id = v_plan_id;

    INSERT INTO public.playlist_policy_alerts (managed_playlist_id, alert_type, severity, message, details)
    VALUES (p_playlist_id, 'policy_missing', 'warning',
            'Playlist sem política editorial; rebalanceamento bloqueado.',
            jsonb_build_object('plan_id', v_plan_id));
    RETURN v_plan_id;
  END IF;

  -- Estado atual + classificação (Campaign > Catalog > ThirdParty)
  CREATE TEMP TABLE _cur ON COMMIT DROP AS
  SELECT
    mpt.spotify_track_id,
    mpt.position,
    COALESCE(o.origin, 'ThirdParty') AS origin,
    ROW_NUMBER() OVER (PARTITION BY mpt.spotify_track_id ORDER BY mpt.position NULLS LAST) AS dup_rank
  FROM public.managed_playlist_tracks mpt
  LEFT JOIN public.v_playlist_track_origin o
    ON o.managed_playlist_id = mpt.playlist_id
   AND o.spotify_track_id   = mpt.spotify_track_id
  WHERE mpt.playlist_id = p_playlist_id;

  SELECT count(*) INTO v_total_current FROM _cur;
  SELECT count(*) INTO v_campaign_count FROM _cur WHERE origin='Campaign' AND dup_rank=1;
  SELECT count(*) INTO v_third_count FROM _cur WHERE origin='ThirdParty' AND dup_rank=1;
  v_third_cap := floor(GREATEST(v_total_current,1) * v_policy.third_party_max_pct / 100.0);

  -- ===========================================================
  -- OP 1: REMOVE duplicatas intra-playlist (regra fundadora)
  -- ===========================================================
  INSERT INTO public.occupancy_plan_ops (plan_id, op_type, spotify_track_id, classification, from_position, reason)
  SELECT v_plan_id, 'REMOVE', spotify_track_id, origin, position,
         'dedupe_intra_playlist'
  FROM _cur WHERE dup_rank > 1;
  GET DIAGNOSTICS v_dup_removed = ROW_COUNT;

  -- ===========================================================
  -- OP 2: REPOSITION para garantir top-N reservado a Campaign
  -- ===========================================================
  WITH camp_below AS (
    SELECT spotify_track_id, position
    FROM _cur
    WHERE dup_rank=1 AND origin='Campaign' AND position > v_policy.protect_top_n
    ORDER BY position ASC
    LIMIT v_policy.protect_top_n
  ),
  non_camp_top AS (
    SELECT spotify_track_id, position
    FROM _cur
    WHERE dup_rank=1 AND origin <> 'Campaign' AND position <= v_policy.protect_top_n
    ORDER BY position ASC
    LIMIT (SELECT count(*) FROM camp_below)
  ),
  pairs AS (
    SELECT
      ROW_NUMBER() OVER (ORDER BY cb.position) AS n,
      cb.spotify_track_id AS camp_track, cb.position AS camp_pos,
      nc.position AS new_pos
    FROM camp_below cb
    JOIN non_camp_top nc ON ROW_NUMBER() OVER (ORDER BY nc.position) = ROW_NUMBER() OVER (ORDER BY cb.position)
  )
  INSERT INTO public.occupancy_plan_ops (plan_id, op_type, spotify_track_id, classification, from_position, to_position, reason)
  SELECT v_plan_id, 'REPOSITION', camp_track, 'Campaign', camp_pos, new_pos, 'protect_top_n_campaign'
  FROM (
    SELECT cb.spotify_track_id AS camp_track,
           cb.position AS camp_pos,
           nc.new_pos
      FROM (
        SELECT spotify_track_id, position, ROW_NUMBER() OVER (ORDER BY position) rn
          FROM _cur WHERE dup_rank=1 AND origin='Campaign' AND position > v_policy.protect_top_n
      ) cb
      JOIN (
        SELECT position AS new_pos, ROW_NUMBER() OVER (ORDER BY position) rn
          FROM _cur WHERE dup_rank=1 AND origin <> 'Campaign' AND position <= v_policy.protect_top_n
      ) nc ON nc.rn = cb.rn
  ) z;
  GET DIAGNOSTICS v_repos = ROW_COUNT;
  v_top_gaps := v_repos;

  -- ===========================================================
  -- OP 3: INSERT candidatos do catálogo p/ slots livres
  --       (apenas se houver headroom; E3: não remove em massa)
  -- ===========================================================
  IF v_total_current < (v_policy.campaign_reserved_slots + v_policy.catalog_capacity) THEN
    WITH livres AS (
      SELECT (v_policy.campaign_reserved_slots + v_policy.catalog_capacity) - v_total_current AS qtd
    ),
    candidatos AS (
      SELECT ct.spotify_track_id
        FROM public.catalog_placements cp
        JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id
       WHERE cp.managed_playlist_id = p_playlist_id
         AND cp.status = 'active'
         AND ct.spotify_track_id NOT IN (SELECT spotify_track_id FROM _cur WHERE dup_rank=1)
       LIMIT (SELECT qtd FROM livres)
    )
    INSERT INTO public.occupancy_plan_ops (plan_id, op_type, spotify_track_id, classification, to_position, reason)
    SELECT v_plan_id, 'INSERT', spotify_track_id, 'Catalog',
           v_total_current + ROW_NUMBER() OVER (), 'fill_free_slot'
    FROM candidatos;
    GET DIAGNOSTICS v_inserts = ROW_COUNT;
  END IF;

  -- ===========================================================
  -- OP 4: REMOVE excedente de terceiros (E3: gradual, no máx 25%)
  -- ===========================================================
  IF v_third_count > v_third_cap THEN
    v_third_overflow := v_third_count - v_third_cap;
    INSERT INTO public.occupancy_plan_ops (plan_id, op_type, spotify_track_id, classification, from_position, reason)
    SELECT v_plan_id, 'REMOVE', spotify_track_id, 'ThirdParty', position,
           'third_party_overflow_gradual'
    FROM _cur
    WHERE dup_rank=1 AND origin='ThirdParty'
    ORDER BY position DESC
    LIMIT GREATEST(1, ceil(v_third_overflow::numeric / 4.0)::int);
  END IF;

  -- Finaliza plano
  UPDATE public.occupancy_plans
     SET status = 'ready',
         finalized_at = now(),
         stats = jsonb_build_object(
           'total_current', v_total_current,
           'campaign_count', v_campaign_count,
           'third_party_count', v_third_count,
           'third_party_cap', v_third_cap,
           'third_party_overflow', v_third_overflow,
           'duplicates_removed', v_dup_removed,
           'campaign_repositions', v_repos,
           'catalog_inserts', v_inserts
         )
   WHERE id = v_plan_id;

  RETURN v_plan_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_playlist_occupancy_rebuild(uuid,text) TO authenticated, service_role;

-- =========================================================
-- 4) Helper batch (SHADOW)
-- =========================================================
CREATE OR REPLACE FUNCTION public.fn_playlist_occupancy_rebuild_batch(
  p_limit integer DEFAULT 10,
  p_policy_type text DEFAULT NULL
)
RETURNS TABLE(playlist_id uuid, plan_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE r record; v_plan uuid;
BEGIN
  FOR r IN
    SELECT mp.id
    FROM public.managed_playlists mp
    LEFT JOIN public.playlist_editorial_policies p ON p.managed_playlist_id = mp.id
    WHERE mp.archived_at IS NULL
      AND (p_policy_type IS NULL OR p.policy_type = p_policy_type)
    ORDER BY mp.updated_at DESC
    LIMIT p_limit
  LOOP
    v_plan := public.fn_playlist_occupancy_rebuild(r.id, 'SHADOW');
    playlist_id := r.id; plan_id := v_plan; RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_playlist_occupancy_rebuild_batch(integer,text) TO authenticated, service_role;
