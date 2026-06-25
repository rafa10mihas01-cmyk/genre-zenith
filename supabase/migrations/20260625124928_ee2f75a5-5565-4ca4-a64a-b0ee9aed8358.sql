
-- Fase 1: Analysis Snapshot — infraestrutura base
-- Cria as três tabelas oficiais do contrato Snapshot:
--   analysis_snapshots         (cabeçalho/estado)
--   analysis_snapshot_results  (resultado de cada etapa)
--   analysis_snapshot_events   (log de observabilidade)

-- ============================================================
-- 1) ENUMS
-- ============================================================
CREATE TYPE public.analysis_snapshot_status AS ENUM (
  'processing', 'ready', 'failed', 'superseded'
);

CREATE TYPE public.analysis_snapshot_trigger AS ENUM (
  'auto_sync',
  'tracks_changed',
  'meta_changed',
  'cover_changed',
  'manual_reanalyze',
  'import',
  'reactivation',
  'cron_catalog',
  'observer'
);

CREATE TYPE public.analysis_snapshot_step AS ENUM (
  'sync', 'dna', 'diagnose', 'brain', 'score'
);

CREATE TYPE public.analysis_step_status AS ENUM (
  'pending', 'running', 'done', 'failed', 'timeout'
);

-- ============================================================
-- 2) TABELA: analysis_snapshots
-- ============================================================
CREATE TABLE public.analysis_snapshots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id           uuid NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,

  status                public.analysis_snapshot_status NOT NULL DEFAULT 'processing',
  trigger_event         public.analysis_snapshot_trigger NOT NULL,
  trigger_payload       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Idempotência (ajuste 2)
  request_hash          text,
  event_hash            text,
  idempotency_key       text,

  -- Guard de consistência das tracks
  tracks_hash           text,

  -- Versionamento por referência (ajuste 3 do doc original)
  dna_version           text,
  genre_brain_version   text,
  market_version        text,
  strategy_version      text,

  -- Encadeamento e supersede
  superseded_by         uuid REFERENCES public.analysis_snapshots(id) ON DELETE SET NULL,
  pending_event_id      uuid, -- evento mais recente recebido durante processamento

  -- Telemetria de tempo
  started_at            timestamptz NOT NULL DEFAULT now(),
  ready_at              timestamptz,
  failed_at             timestamptz,
  failure_reason        text,

  -- Métricas agregadas (ajuste 7)
  metrics               jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Lock por playlist (ajuste 8): apenas um snapshot processing por playlist
CREATE UNIQUE INDEX analysis_snapshots_one_processing_per_playlist
  ON public.analysis_snapshots (playlist_id)
  WHERE status = 'processing';

-- Idempotência (ajuste 2): nunca dois snapshots ativos com mesma idempotency_key
CREATE UNIQUE INDEX analysis_snapshots_idempotency_active
  ON public.analysis_snapshots (playlist_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status IN ('processing', 'ready');

-- Leitura do "último ready" por playlist (caminho principal da UI)
CREATE INDEX analysis_snapshots_playlist_ready_recent
  ON public.analysis_snapshots (playlist_id, ready_at DESC)
  WHERE status = 'ready';

-- Reaper / observabilidade
CREATE INDEX analysis_snapshots_status_started
  ON public.analysis_snapshots (status, started_at);

CREATE INDEX analysis_snapshots_playlist_created
  ON public.analysis_snapshots (playlist_id, created_at DESC);

GRANT SELECT ON public.analysis_snapshots TO authenticated;
GRANT ALL    ON public.analysis_snapshots TO service_role;

ALTER TABLE public.analysis_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read snapshots"
  ON public.analysis_snapshots FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role full access on snapshots"
  ON public.analysis_snapshots FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 3) TABELA: analysis_snapshot_results
-- ============================================================
CREATE TABLE public.analysis_snapshot_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     uuid NOT NULL REFERENCES public.analysis_snapshots(id) ON DELETE CASCADE,
  step            public.analysis_snapshot_step NOT NULL,

  status          public.analysis_step_status NOT NULL DEFAULT 'pending',

  -- Retry (ajuste 4)
  retry_count     integer NOT NULL DEFAULT 0,
  max_retry       integer NOT NULL DEFAULT 3,
  last_retry_at   timestamptz,

  -- Timeout individual por etapa (ajuste 3)
  timeout_seconds integer NOT NULL DEFAULT 180,

  started_at      timestamptz,
  finished_at     timestamptz,
  duration_ms     integer,

  result          jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics         jsonb NOT NULL DEFAULT '{}'::jsonb,
  error           text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (snapshot_id, step)
);

CREATE INDEX analysis_snapshot_results_snapshot
  ON public.analysis_snapshot_results (snapshot_id);

CREATE INDEX analysis_snapshot_results_running
  ON public.analysis_snapshot_results (status, started_at)
  WHERE status = 'running';

GRANT SELECT ON public.analysis_snapshot_results TO authenticated;
GRANT ALL    ON public.analysis_snapshot_results TO service_role;

ALTER TABLE public.analysis_snapshot_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read snapshot results"
  ON public.analysis_snapshot_results FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role full access on snapshot results"
  ON public.analysis_snapshot_results FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 4) TABELA: analysis_snapshot_events  (ajuste 6 — observabilidade)
-- ============================================================
CREATE TABLE public.analysis_snapshot_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id   uuid NOT NULL REFERENCES public.analysis_snapshots(id) ON DELETE CASCADE,
  playlist_id   uuid NOT NULL,
  event_type    text NOT NULL,         -- snapshot_created, sync_started, sync_finished, ...
  step          public.analysis_snapshot_step,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analysis_snapshot_events_snapshot
  ON public.analysis_snapshot_events (snapshot_id, created_at);

CREATE INDEX analysis_snapshot_events_playlist
  ON public.analysis_snapshot_events (playlist_id, created_at DESC);

CREATE INDEX analysis_snapshot_events_type
  ON public.analysis_snapshot_events (event_type, created_at DESC);

GRANT SELECT ON public.analysis_snapshot_events TO authenticated;
GRANT ALL    ON public.analysis_snapshot_events TO service_role;

ALTER TABLE public.analysis_snapshot_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read snapshot events"
  ON public.analysis_snapshot_events FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role full access on snapshot events"
  ON public.analysis_snapshot_events FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 5) Trigger genérico updated_at (usa função padrão se existir)
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_analysis_snapshot_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER analysis_snapshots_touch
  BEFORE UPDATE ON public.analysis_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.tg_analysis_snapshot_touch();

CREATE TRIGGER analysis_snapshot_results_touch
  BEFORE UPDATE ON public.analysis_snapshot_results
  FOR EACH ROW EXECUTE FUNCTION public.tg_analysis_snapshot_touch();
