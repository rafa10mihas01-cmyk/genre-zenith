CREATE TABLE public.plan_execution_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id     UUID NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  diagnosis_id    UUID REFERENCES public.playlist_diagnoses(id) ON DELETE SET NULL,
  executed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_by     UUID,

  baseline_benchmark_tracks    NUMERIC,
  baseline_ratio_to_benchmark  NUMERIC,
  baseline_size                INTEGER,
  baseline_saturation_avg      NUMERIC,
  baseline_dominant_artists    INTEGER,
  baseline_headroom_pct        NUMERIC,

  projected_benchmark_delta        NUMERIC,
  projected_artist_delta           NUMERIC,
  projected_coverage_delta_pp      NUMERIC,
  projected_saturation_delta_pp    NUMERIC,
  projected_concentration_delta_pp NUMERIC,
  projected_size_delta             NUMERIC,
  projected_headroom_delta_pp      NUMERIC,
  projected_confidence             TEXT,

  ops_add     INTEGER NOT NULL DEFAULT 0,
  ops_remove  INTEGER NOT NULL DEFAULT 0,
  ops_promote INTEGER NOT NULL DEFAULT 0,
  ops_demote  INTEGER NOT NULL DEFAULT 0,

  status            TEXT NOT NULL DEFAULT 'pending',
  evaluation_notes  TEXT,
  evaluated_at      TIMESTAMPTZ,

  measured_benchmark_delta        NUMERIC,
  measured_artist_delta           NUMERIC,
  measured_coverage_delta_pp      NUMERIC,
  measured_saturation_delta_pp    NUMERIC,
  measured_concentration_delta_pp NUMERIC,
  measured_size_delta             NUMERIC,
  measured_headroom_delta_pp      NUMERIC,
  accuracy_by_metric              JSONB,
  accuracy_overall                NUMERIC,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT plan_exec_snap_status_chk CHECK (status IN ('pending','evaluated','superseded'))
);

CREATE INDEX plan_exec_snap_playlist_executed_idx
  ON public.plan_execution_snapshots (playlist_id, executed_at DESC);

CREATE INDEX plan_exec_snap_pending_idx
  ON public.plan_execution_snapshots (executed_at)
  WHERE status = 'pending';

CREATE INDEX plan_exec_snap_diagnosis_idx
  ON public.plan_execution_snapshots (diagnosis_id);

GRANT SELECT ON public.plan_execution_snapshots TO authenticated;
GRANT ALL    ON public.plan_execution_snapshots TO service_role;

ALTER TABLE public.plan_execution_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team can read plan execution snapshots"
  ON public.plan_execution_snapshots
  FOR SELECT
  TO authenticated
  USING (public.has_team_access());

CREATE TRIGGER plan_exec_snap_set_updated_at
  BEFORE UPDATE ON public.plan_execution_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();