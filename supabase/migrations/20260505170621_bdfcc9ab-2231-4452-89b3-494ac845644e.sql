
-- 1. Adiciona batch_id em curator_deal_snapshots (rastreabilidade e dedupe)
ALTER TABLE public.curator_deal_snapshots
  ADD COLUMN IF NOT EXISTS batch_id uuid;

CREATE INDEX IF NOT EXISTS idx_curator_deal_snapshots_batch
  ON public.curator_deal_snapshots(batch_id);

-- Unique partial: dentro do mesmo batch, uma linha por playlist
CREATE UNIQUE INDEX IF NOT EXISTS uq_snapshot_batch_playlist
  ON public.curator_deal_snapshots(batch_id, playlist_id)
  WHERE batch_id IS NOT NULL;

-- 2. Limpeza: deduplica snapshots do batch problemático 180e439e (mantém maior plays / mais recente)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY deal_id, song_id, playlist_id
           ORDER BY plays DESC, captured_at DESC
         ) AS rn
  FROM public.curator_deal_snapshots
  WHERE deal_id = '7aceab85-33d8-444f-a2ee-f7a6d6d6a167'
    AND captured_at >= '2026-05-05 16:15:00+00'
    AND captured_at <= '2026-05-05 16:50:00+00'
)
DELETE FROM public.curator_deal_snapshots s
USING ranked r
WHERE s.id = r.id AND r.rn > 1;

-- 3. Marca os snapshots remanescentes desse batch com batch_id correto
UPDATE public.curator_deal_snapshots
SET batch_id = '180e439e-1bfa-491f-964c-ae0ef3887a33'
WHERE deal_id = '7aceab85-33d8-444f-a2ee-f7a6d6d6a167'
  AND captured_at >= '2026-05-05 16:15:00+00'
  AND captured_at <= '2026-05-05 16:50:00+00'
  AND batch_id IS NULL;
