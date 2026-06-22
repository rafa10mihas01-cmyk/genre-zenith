
-- =========================================================
-- Distribuição Natural do Catálogo
-- =========================================================

-- 1) Configurações (system_flags)
ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS engine_natural_distribution_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS engine_natural_distribution_window_days smallint NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS engine_natural_distribution_wave_size smallint NOT NULL DEFAULT 50;

-- 2) Tabela de planos
CREATE TABLE IF NOT EXISTS public.catalog_distribution_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_track_id uuid NOT NULL REFERENCES public.catalog_tracks(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active', -- active | completed | cancelled | empty
  window_days smallint NOT NULL DEFAULT 5,
  total_eligible integer NOT NULL DEFAULT 0,
  total_distributed integer NOT NULL DEFAULT 0,
  total_skipped integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  expected_end_at timestamptz NULL,
  completed_at timestamptz NULL,
  next_wave_at timestamptz NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.catalog_distribution_plans TO authenticated;
GRANT ALL ON public.catalog_distribution_plans TO service_role;

ALTER TABLE public.catalog_distribution_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role manages distribution plans"
  ON public.catalog_distribution_plans FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated reads distribution plans"
  ON public.catalog_distribution_plans FOR SELECT TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_cd_plans_track ON public.catalog_distribution_plans(catalog_track_id);
CREATE INDEX IF NOT EXISTS idx_cd_plans_status_next ON public.catalog_distribution_plans(status, next_wave_at);

-- 3) Tabela de alvos do plano (uma linha por playlist)
CREATE TABLE IF NOT EXISTS public.catalog_distribution_plan_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.catalog_distribution_plans(id) ON DELETE CASCADE,
  catalog_track_id uuid NOT NULL REFERENCES public.catalog_tracks(id) ON DELETE CASCADE,
  managed_playlist_id uuid NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending', -- pending | distributed | skipped
  scheduled_for timestamptz NOT NULL,
  distributed_at timestamptz NULL,
  placement_id uuid NULL,
  skip_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, managed_playlist_id)
);

GRANT SELECT ON public.catalog_distribution_plan_targets TO authenticated;
GRANT ALL ON public.catalog_distribution_plan_targets TO service_role;

ALTER TABLE public.catalog_distribution_plan_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role manages plan targets"
  ON public.catalog_distribution_plan_targets FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated reads plan targets"
  ON public.catalog_distribution_plan_targets FOR SELECT TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_cd_targets_due
  ON public.catalog_distribution_plan_targets(status, scheduled_for)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cd_targets_plan
  ON public.catalog_distribution_plan_targets(plan_id);
CREATE INDEX IF NOT EXISTS idx_cd_targets_track
  ON public.catalog_distribution_plan_targets(catalog_track_id);

-- 4) Função: cria plano para uma música usando os critérios da Fase 2
CREATE OR REPLACE FUNCTION public.engine_create_distribution_plan(
  _track_id uuid,
  _days smallint DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
  v_days smallint;
  v_existing uuid;
  v_track record;
  v_eligible_count integer := 0;
  v_idx integer := 0;
  v_now timestamptz := now();
  v_pl record;
BEGIN
  SELECT id, status, genre_id INTO v_track FROM public.catalog_tracks WHERE id = _track_id;
  IF v_track.id IS NULL OR v_track.status <> 'active' THEN
    RETURN NULL;
  END IF;

  -- evita duplicar planos ativos
  SELECT id INTO v_existing
  FROM public.catalog_distribution_plans
  WHERE catalog_track_id = _track_id AND status = 'active'
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT COALESCE(_days, engine_natural_distribution_window_days, 5)
    INTO v_days
  FROM public.system_flags ORDER BY id LIMIT 1;
  v_days := GREATEST(1, LEAST(v_days, 14));

  INSERT INTO public.catalog_distribution_plans (
    catalog_track_id, status, window_days, started_at,
    expected_end_at, next_wave_at
  )
  VALUES (
    _track_id, 'active', v_days, v_now,
    v_now + (v_days || ' days')::interval, v_now
  )
  RETURNING id INTO v_plan_id;

  -- Playlists compatíveis (mesmo critério da Fase 2)
  FOR v_pl IN
    SELECT o.managed_playlist_id
    FROM public.v_catalog_playlist_occupancy o
    JOIN public.managed_playlists mp ON mp.id = o.managed_playlist_id
    WHERE o.archived_at IS NULL
      AND o.available_slots > 0
      AND (v_track.genre_id IS NULL OR mp.genre_id IS NULL OR mp.genre_id = v_track.genre_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.playlist_cooldowns pc
        WHERE pc.playlist_id = o.managed_playlist_id
          AND pc.action_type IN ('tracks_light','tracks_recycle')
          AND pc.cooldown_until > v_now
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.catalog_placements cp
        WHERE cp.catalog_track_id = _track_id
          AND cp.managed_playlist_id = o.managed_playlist_id
          AND cp.status IN ('pending','active')
      )
    ORDER BY o.available_slots DESC, o.managed_playlist_id
  LOOP
    v_idx := v_idx + 1;
    INSERT INTO public.catalog_distribution_plan_targets (
      plan_id, catalog_track_id, managed_playlist_id,
      status, scheduled_for
    )
    VALUES (
      v_plan_id, _track_id, v_pl.managed_playlist_id,
      'pending',
      -- distribui linearmente pelos N dias da janela
      v_now + ( (v_idx::numeric / GREATEST(1, 1)) * 0 || ' seconds' )::interval
    )
    ON CONFLICT DO NOTHING;
    v_eligible_count := v_eligible_count + 1;
  END LOOP;

  -- redistribui scheduled_for uniformemente na janela
  UPDATE public.catalog_distribution_plan_targets t
     SET scheduled_for = v_now + ( ((ord - 1)::numeric / GREATEST(1, v_eligible_count - 1)) * (v_days * 86400) || ' seconds' )::interval
    FROM (
      SELECT id, row_number() OVER (ORDER BY random()) AS ord
        FROM public.catalog_distribution_plan_targets
       WHERE plan_id = v_plan_id
    ) s
   WHERE t.id = s.id;

  UPDATE public.catalog_distribution_plans
     SET total_eligible = v_eligible_count,
         status = CASE WHEN v_eligible_count = 0 THEN 'empty' ELSE 'active' END,
         completed_at = CASE WHEN v_eligible_count = 0 THEN v_now ELSE NULL END,
         updated_at = v_now
   WHERE id = v_plan_id;

  RETURN v_plan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.engine_create_distribution_plan(uuid, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.engine_create_distribution_plan(uuid, smallint) TO service_role, authenticated;

-- 5) Função: executa uma onda de distribuição (insere catalog_placements pending)
CREATE OR REPLACE FUNCTION public.engine_run_distribution_wave(_limit integer DEFAULT NULL)
RETURNS TABLE(distributed integer, skipped integer, remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active boolean;
  v_default_wave smallint;
  v_now timestamptz := now();
  v_limit integer;
  v_dist integer := 0;
  v_skip integer := 0;
  v_rem integer := 0;
  r record;
  v_avail integer;
  v_exists boolean;
  v_placement_id uuid;
BEGIN
  SELECT engine_natural_distribution_active, engine_natural_distribution_wave_size
    INTO v_active, v_default_wave
  FROM public.system_flags ORDER BY id LIMIT 1;

  IF NOT COALESCE(v_active, false) THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  v_limit := COALESCE(_limit, v_default_wave, 50);
  v_limit := GREATEST(1, LEAST(v_limit, 500));

  FOR r IN
    SELECT t.id, t.plan_id, t.catalog_track_id, t.managed_playlist_id
      FROM public.catalog_distribution_plan_targets t
      JOIN public.catalog_distribution_plans p ON p.id = t.plan_id
     WHERE t.status = 'pending'
       AND t.scheduled_for <= v_now
       AND p.status = 'active'
     ORDER BY t.scheduled_for
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    -- ainda tem vaga?
    SELECT available_slots INTO v_avail
      FROM public.v_catalog_playlist_occupancy
     WHERE managed_playlist_id = r.managed_playlist_id;
    IF v_avail IS NULL OR v_avail <= 0 THEN
      UPDATE public.catalog_distribution_plan_targets
         SET status = 'skipped', skip_reason = 'no_capacity', updated_at = v_now
       WHERE id = r.id;
      v_skip := v_skip + 1;
      CONTINUE;
    END IF;

    -- já existe placement?
    SELECT EXISTS(
      SELECT 1 FROM public.catalog_placements cp
       WHERE cp.catalog_track_id = r.catalog_track_id
         AND cp.managed_playlist_id = r.managed_playlist_id
         AND cp.status IN ('pending','active')
    ) INTO v_exists;
    IF v_exists THEN
      UPDATE public.catalog_distribution_plan_targets
         SET status = 'skipped', skip_reason = 'already_placed', updated_at = v_now
       WHERE id = r.id;
      v_skip := v_skip + 1;
      CONTINUE;
    END IF;

    -- insere placement pending → worker existente sincroniza com Spotify
    INSERT INTO public.catalog_placements (
      catalog_track_id, managed_playlist_id, status, scheduled_for, origin
    )
    VALUES (
      r.catalog_track_id, r.managed_playlist_id, 'pending', v_now, 'CATALOG'
    )
    RETURNING id INTO v_placement_id;

    UPDATE public.catalog_distribution_plan_targets
       SET status = 'distributed',
           distributed_at = v_now,
           placement_id = v_placement_id,
           updated_at = v_now
     WHERE id = r.id;
    v_dist := v_dist + 1;
  END LOOP;

  -- atualiza contadores e estado dos planos tocados
  UPDATE public.catalog_distribution_plans p
     SET total_distributed = sub.dist,
         total_skipped = sub.skip,
         next_wave_at = sub.next_due,
         status = CASE WHEN sub.pending = 0 THEN 'completed' ELSE 'active' END,
         completed_at = CASE WHEN sub.pending = 0 THEN v_now ELSE NULL END,
         updated_at = v_now
    FROM (
      SELECT plan_id,
             SUM((status='distributed')::int) AS dist,
             SUM((status='skipped')::int) AS skip,
             SUM((status='pending')::int) AS pending,
             MIN(scheduled_for) FILTER (WHERE status='pending') AS next_due
        FROM public.catalog_distribution_plan_targets
       GROUP BY plan_id
    ) sub
   WHERE p.id = sub.plan_id
     AND p.status = 'active';

  SELECT COUNT(*) INTO v_rem
    FROM public.catalog_distribution_plan_targets t
    JOIN public.catalog_distribution_plans p ON p.id = t.plan_id
   WHERE t.status = 'pending' AND p.status = 'active';

  RETURN QUERY SELECT v_dist, v_skip, v_rem;
END;
$$;

REVOKE ALL ON FUNCTION public.engine_run_distribution_wave(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.engine_run_distribution_wave(integer) TO service_role, authenticated;

-- 6) Trigger: ao inserir / ativar música no catálogo, cria plano (se flag ON)
CREATE OR REPLACE FUNCTION public.trg_catalog_track_create_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active boolean;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN RETURN NEW; END IF;

  SELECT engine_natural_distribution_active INTO v_active
  FROM public.system_flags ORDER BY id LIMIT 1;
  IF NOT COALESCE(v_active, false) THEN RETURN NEW; END IF;

  PERFORM public.engine_create_distribution_plan(NEW.id, NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_catalog_track_create_plan ON public.catalog_tracks;
CREATE TRIGGER trg_catalog_track_create_plan
  AFTER INSERT OR UPDATE OF status ON public.catalog_tracks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_catalog_track_create_plan();

-- 7) Cron: roda onda a cada 15 minutos (a função respeita a flag internamente)
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('engine-distribution-wave')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'engine-distribution-wave');
    PERFORM cron.schedule(
      'engine-distribution-wave',
      '*/15 * * * *',
      $job$ SELECT public.engine_run_distribution_wave(); $job$
    );
  END IF;
END
$cron$;

-- 8) View de leitura amigável dos planos
CREATE OR REPLACE VIEW public.v_catalog_distribution_plans AS
SELECT p.id,
       p.catalog_track_id,
       ct.track_name,
       ct.artist_name,
       p.status,
       p.window_days,
       p.total_eligible,
       p.total_distributed,
       p.total_skipped,
       GREATEST(0, p.total_eligible - p.total_distributed - p.total_skipped) AS total_pending,
       CASE WHEN p.total_eligible > 0
            THEN round((p.total_distributed::numeric / p.total_eligible) * 100, 1)
            ELSE 0 END AS percent_done,
       p.started_at,
       p.expected_end_at,
       p.completed_at,
       p.next_wave_at
  FROM public.catalog_distribution_plans p
  JOIN public.catalog_tracks ct ON ct.id = p.catalog_track_id;

ALTER VIEW public.v_catalog_distribution_plans SET (security_invoker = true);
GRANT SELECT ON public.v_catalog_distribution_plans TO authenticated, service_role;
