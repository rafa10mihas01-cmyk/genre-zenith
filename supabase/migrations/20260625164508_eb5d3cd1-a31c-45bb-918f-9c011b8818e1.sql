
-- Fase 0.1 — Backfill de catalog_placements.position
-- Fonte: managed_playlist_tracks.position (sync canônico)
WITH src AS (
  SELECT cp.id AS placement_id, mpt.position
    FROM public.catalog_placements cp
    JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id
    JOIN public.managed_playlist_tracks mpt
      ON mpt.playlist_id = cp.managed_playlist_id
     AND mpt.spotify_track_id = ct.spotify_track_id
   WHERE cp.position IS NULL
     AND cp.status IN ('active','pending','processing','retry','skipped','waiting_circuit_breaker')
)
UPDATE public.catalog_placements cp
   SET position = src.position, updated_at = now()
  FROM src
 WHERE cp.id = src.placement_id;

-- Fase 0.2 — Índice de telemetria: placements ativos sem posição
CREATE INDEX IF NOT EXISTS idx_catalog_placements_null_position_active
  ON public.catalog_placements (managed_playlist_id)
  WHERE position IS NULL AND status = 'active';

-- Fase 0.3 — Comentário documentando o invariante
COMMENT ON COLUMN public.catalog_placements.position IS
  'Posição 0-indexada na playlist. Persistida pelo worker após add no Spotify. NULL apenas em placements pendentes ainda não executados.';
