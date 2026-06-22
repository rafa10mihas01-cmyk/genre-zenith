
-- ============================================================
-- FASE 2 — Engine de Catálogo: módulo de OCUPAÇÃO (dry-run)
-- Nada vai para o Spotify; nada altera catalog_placements.
-- ============================================================

-- 1) Run log do módulo (uma linha por execução)
CREATE TABLE IF NOT EXISTS public.engine_occupancy_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  mode text NOT NULL DEFAULT 'dry_run' CHECK (mode IN ('dry_run','live')),
  scope_playlist_id uuid,
  playlists_scanned integer NOT NULL DEFAULT 0,
  playlists_with_gap integer NOT NULL DEFAULT 0,
  proposals_generated integer NOT NULL DEFAULT 0,
  candidates_considered integer NOT NULL DEFAULT 0,
  notes jsonb,
  error text
);

GRANT SELECT ON public.engine_occupancy_runs TO authenticated;
GRANT ALL ON public.engine_occupancy_runs TO service_role;

ALTER TABLE public.engine_occupancy_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read engine_occupancy_runs" ON public.engine_occupancy_runs;
CREATE POLICY "admins read engine_occupancy_runs"
  ON public.engine_occupancy_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_engine_occupancy_runs_started
  ON public.engine_occupancy_runs (started_at DESC);

-- 2) Tabela de propostas (dry-run)
CREATE TABLE IF NOT EXISTS public.engine_occupancy_proposals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.engine_occupancy_runs(id) ON DELETE CASCADE,
  managed_playlist_id uuid NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  catalog_track_id uuid NOT NULL REFERENCES public.catalog_tracks(id) ON DELETE CASCADE,
  slot_index integer,
  available_slots_at_run integer,
  reason text NOT NULL DEFAULT 'genre_match',
  match_components jsonb,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','accepted','discarded','expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.engine_occupancy_proposals TO authenticated;
GRANT ALL ON public.engine_occupancy_proposals TO service_role;

ALTER TABLE public.engine_occupancy_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read engine_occupancy_proposals" ON public.engine_occupancy_proposals;
CREATE POLICY "admins read engine_occupancy_proposals"
  ON public.engine_occupancy_proposals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_engine_occupancy_proposals_run
  ON public.engine_occupancy_proposals (run_id);
CREATE INDEX IF NOT EXISTS idx_engine_occupancy_proposals_playlist
  ON public.engine_occupancy_proposals (managed_playlist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engine_occupancy_proposals_track
  ON public.engine_occupancy_proposals (catalog_track_id);

-- 3) Função de proposta de ocupação (sempre dry-run nesta fase)
CREATE OR REPLACE FUNCTION public.engine_propose_playlist_occupancy(
  p_playlist_id uuid DEFAULT NULL,
  p_max_per_playlist integer DEFAULT 10,
  p_max_playlists integer DEFAULT 50
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_playlists_scanned int := 0;
  v_playlists_with_gap int := 0;
  v_proposals int := 0;
  v_candidates int := 0;
  v_pl record;
BEGIN
  INSERT INTO public.engine_occupancy_runs (mode, scope_playlist_id)
  VALUES ('dry_run', p_playlist_id)
  RETURNING id INTO v_run_id;

  FOR v_pl IN
    SELECT
      o.managed_playlist_id,
      o.available_slots,
      mp.genre_id
    FROM public.v_catalog_playlist_occupancy o
    JOIN public.managed_playlists mp ON mp.id = o.managed_playlist_id
    WHERE o.archived_at IS NULL
      AND o.available_slots > 0
      AND (p_playlist_id IS NULL OR o.managed_playlist_id = p_playlist_id)
      -- pula playlists com cooldown ativo de mexer em faixas
      AND NOT EXISTS (
        SELECT 1 FROM public.playlist_cooldowns pc
        WHERE pc.playlist_id = o.managed_playlist_id
          AND pc.action_type IN ('tracks_light','tracks_recycle')
          AND pc.cooldown_until > now()
      )
    ORDER BY o.available_slots DESC
    LIMIT GREATEST(p_max_playlists, 1)
  LOOP
    v_playlists_scanned := v_playlists_scanned + 1;
    v_playlists_with_gap := v_playlists_with_gap + 1;

    WITH candidates AS (
      SELECT
        ct.id AS catalog_track_id,
        row_number() OVER (ORDER BY ct.id) AS rn
      FROM public.catalog_tracks ct
      WHERE ct.status = 'active'
        AND (v_pl.genre_id IS NULL OR ct.genre_id = v_pl.genre_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.catalog_placements cp
          WHERE cp.catalog_track_id = ct.id
            AND cp.managed_playlist_id = v_pl.managed_playlist_id
            AND cp.status <> 'removed'
        )
      LIMIT GREATEST(p_max_per_playlist, 1)
    ),
    inserted AS (
      INSERT INTO public.engine_occupancy_proposals (
        run_id, managed_playlist_id, catalog_track_id,
        slot_index, available_slots_at_run, reason, match_components
      )
      SELECT
        v_run_id,
        v_pl.managed_playlist_id,
        c.catalog_track_id,
        c.rn::int,
        v_pl.available_slots,
        CASE WHEN v_pl.genre_id IS NULL THEN 'any_genre' ELSE 'genre_match' END,
        jsonb_build_object(
          'genre_id', v_pl.genre_id,
          'available_slots', v_pl.available_slots
        )
      FROM candidates c
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_candidates FROM inserted;

    v_proposals := v_proposals + COALESCE(v_candidates, 0);
  END LOOP;

  UPDATE public.engine_occupancy_runs
  SET finished_at = now(),
      playlists_scanned = v_playlists_scanned,
      playlists_with_gap = v_playlists_with_gap,
      proposals_generated = v_proposals,
      candidates_considered = v_proposals
  WHERE id = v_run_id;

  RETURN v_run_id;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.engine_occupancy_runs
  SET finished_at = now(),
      error = SQLERRM
  WHERE id = v_run_id;
  RAISE;
END;
$$;

-- Acesso: apenas service_role e admins via RPC
REVOKE ALL ON FUNCTION public.engine_propose_playlist_occupancy(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.engine_propose_playlist_occupancy(uuid, integer, integer) TO service_role;
