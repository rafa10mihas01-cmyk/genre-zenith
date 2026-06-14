
-- ============================================================
-- Passo 2: Fila de snapshots do Catálogo + claim atômico + triggers
-- ============================================================

CREATE TABLE IF NOT EXISTS public.catalog_snapshot_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_track_id uuid NOT NULL REFERENCES public.catalog_tracks(id) ON DELETE CASCADE,
  spotify_track_id text NOT NULL,
  reason text NOT NULL DEFAULT 'manual',
  priority smallint NOT NULL DEFAULT 2,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','done','failed','retry')),
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  completed_snapshot_id uuid REFERENCES public.song_snapshots(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_snapshot_queue TO authenticated;
GRANT ALL ON public.catalog_snapshot_queue TO service_role;

ALTER TABLE public.catalog_snapshot_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read catalog snapshot queue"
  ON public.catalog_snapshot_queue
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can manage catalog snapshot queue"
  ON public.catalog_snapshot_queue
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX IF NOT EXISTS idx_csq_claim
  ON public.catalog_snapshot_queue (status, priority, scheduled_for)
  WHERE status IN ('pending','retry');

CREATE INDEX IF NOT EXISTS idx_csq_lease
  ON public.catalog_snapshot_queue (lease_expires_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_csq_track
  ON public.catalog_snapshot_queue (catalog_track_id, created_at DESC);

-- Não duplicar: 1 tarefa "pending/retry/processing" por (track, reason) ao mesmo tempo
CREATE UNIQUE INDEX IF NOT EXISTS uq_csq_alive
  ON public.catalog_snapshot_queue (catalog_track_id, reason)
  WHERE status IN ('pending','retry','processing');

CREATE TRIGGER trg_csq_updated_at
  BEFORE UPDATE ON public.catalog_snapshot_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Claim atômico (espelho do padrão de catalog_placements)
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_next_catalog_snapshots(
  p_worker_id text,
  p_limit integer DEFAULT 1,
  p_lease_seconds integer DEFAULT 180
)
RETURNS TABLE (
  id uuid,
  catalog_track_id uuid,
  spotify_track_id text,
  reason text,
  attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT q.id
    FROM public.catalog_snapshot_queue q
    WHERE (
      q.status IN ('pending','retry')
      AND q.scheduled_for <= now()
    )
    OR (
      q.status = 'processing'
      AND q.lease_expires_at IS NOT NULL
      AND q.lease_expires_at < now()
    )
    ORDER BY q.priority ASC, q.scheduled_for ASC
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.catalog_snapshot_queue q
  SET status = 'processing',
      locked_at = now(),
      locked_by = p_worker_id,
      lease_expires_at = now() + make_interval(secs => GREATEST(p_lease_seconds, 30)),
      attempts = q.attempts + 1,
      updated_at = now()
  FROM claimed c
  WHERE q.id = c.id
  RETURNING q.id, q.catalog_track_id, q.spotify_track_id, q.reason, q.attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_catalog_snapshots(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_next_catalog_snapshots(text, integer, integer) TO service_role;

-- ============================================================
-- Triggers de enfileiramento
-- ============================================================

-- 1) Nova música no catálogo → baseline
CREATE OR REPLACE FUNCTION public.tg_enqueue_catalog_baseline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    INSERT INTO public.catalog_snapshot_queue (
      catalog_track_id, spotify_track_id, reason, priority, scheduled_for
    )
    VALUES (NEW.id, NEW.spotify_track_id, 'baseline', 1, now())
    ON CONFLICT (catalog_track_id, reason)
      WHERE status IN ('pending','retry','processing') DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_catalog_tracks_enqueue_baseline ON public.catalog_tracks;
CREATE TRIGGER trg_catalog_tracks_enqueue_baseline
  AFTER INSERT ON public.catalog_tracks
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_catalog_baseline();

-- 2) Placement virou ativo → snapshot recorrente (D+1)
CREATE OR REPLACE FUNCTION public.tg_enqueue_catalog_post_placement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spotify_id text;
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT spotify_track_id INTO v_spotify_id
    FROM public.catalog_tracks
    WHERE id = NEW.catalog_track_id;

    IF v_spotify_id IS NOT NULL THEN
      INSERT INTO public.catalog_snapshot_queue (
        catalog_track_id, spotify_track_id, reason, priority, scheduled_for
      )
      VALUES (NEW.catalog_track_id, v_spotify_id, 'post_placement', 2, now() + interval '24 hours')
      ON CONFLICT (catalog_track_id, reason)
        WHERE status IN ('pending','retry','processing') DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_catalog_placements_enqueue_snapshot ON public.catalog_placements;
CREATE TRIGGER trg_catalog_placements_enqueue_snapshot
  AFTER INSERT OR UPDATE OF status ON public.catalog_placements
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_catalog_post_placement();

-- Backfill: enfileirar baseline para músicas já cadastradas
INSERT INTO public.catalog_snapshot_queue (catalog_track_id, spotify_track_id, reason, priority, scheduled_for)
SELECT ct.id, ct.spotify_track_id, 'baseline', 1, now()
FROM public.catalog_tracks ct
WHERE ct.status = 'active'
ON CONFLICT (catalog_track_id, reason)
  WHERE status IN ('pending','retry','processing') DO NOTHING;
