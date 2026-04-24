-- ============================================================
-- A.1 — Backfill followers_at_creation usando 1º snapshot
-- ============================================================
WITH first_snap AS (
  SELECT DISTINCT ON (template_id)
    template_id,
    followers
  FROM public.playlist_metrics_snapshots
  ORDER BY template_id, collected_at ASC
)
UPDATE public.playlist_templates t
SET followers_at_creation = fs.followers,
    updated_at = now()
FROM first_snap fs
WHERE t.id = fs.template_id
  AND (t.followers_at_creation IS NULL OR t.followers_at_creation = 0)
  AND fs.followers IS NOT NULL;

-- ============================================================
-- C.1 — Unifica status: 'published' → 'created' em replications
-- ============================================================
UPDATE public.replications
SET status = 'created', updated_at = now()
WHERE status = 'published';

-- ============================================================
-- B.2 — Storage policies para bucket playlist-covers
-- Leitura permanece pública (Spotify precisa); escrita só team/service
-- ============================================================
DROP POLICY IF EXISTS "playlist_covers_public_read" ON storage.objects;
DROP POLICY IF EXISTS "playlist_covers_team_write" ON storage.objects;
DROP POLICY IF EXISTS "playlist_covers_team_update" ON storage.objects;
DROP POLICY IF EXISTS "playlist_covers_team_delete" ON storage.objects;

CREATE POLICY "playlist_covers_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'playlist-covers');

CREATE POLICY "playlist_covers_team_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'playlist-covers' AND public.has_team_access());

CREATE POLICY "playlist_covers_team_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'playlist-covers' AND public.has_team_access())
  WITH CHECK (bucket_id = 'playlist-covers' AND public.has_team_access());

CREATE POLICY "playlist_covers_team_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'playlist-covers' AND public.has_team_access());

-- ============================================================
-- D.2 — Índices críticos
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_search_tracks_result_id
  ON public.search_tracks(result_id);

CREATE INDEX IF NOT EXISTS idx_collection_logs_created_at
  ON public.collection_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_playlist_metrics_snap_collected
  ON public.playlist_metrics_snapshots(template_id, collected_at DESC);

-- ============================================================
-- D.1 — Função de retenção / downsampling
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_old_logs_and_snapshots()
RETURNS TABLE(
  logs_deleted integer,
  snapshots_deleted integer,
  tracks_deleted integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_logs int := 0;
  v_snaps int := 0;
  v_tracks int := 0;
BEGIN
  -- collection_logs: deletar > 30 dias
  WITH d AS (
    DELETE FROM public.collection_logs
     WHERE created_at < now() - interval '30 days'
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_logs FROM d;

  -- playlist_metrics_snapshots: manter só último por dia por template após 7 dias
  WITH old_snaps AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY template_id, date_trunc('day', collected_at)
             ORDER BY collected_at DESC
           ) AS rn
    FROM public.playlist_metrics_snapshots
    WHERE collected_at < now() - interval '7 days'
  ),
  d AS (
    DELETE FROM public.playlist_metrics_snapshots
     WHERE id IN (SELECT id FROM old_snaps WHERE rn > 1)
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_snaps FROM d;

  -- search_tracks órfãos (result_id apontando para search_results inexistente)
  WITH d AS (
    DELETE FROM public.search_tracks st
     WHERE st.result_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.search_results sr WHERE sr.id = st.result_id)
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_tracks FROM d;

  RETURN QUERY SELECT v_logs, v_snaps, v_tracks;
END;
$$;