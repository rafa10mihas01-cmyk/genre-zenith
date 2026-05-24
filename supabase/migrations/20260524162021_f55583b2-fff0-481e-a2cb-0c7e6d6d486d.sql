-- Adiciona coluna + índice em delivery_proofs e backfill via curator_deal_songs
ALTER TABLE public.delivery_proofs
  ADD COLUMN IF NOT EXISTS spotify_track_id text;

CREATE INDEX IF NOT EXISTS idx_delivery_proofs_spotify_track_id
  ON public.delivery_proofs (spotify_track_id);

UPDATE public.delivery_proofs dp
SET spotify_track_id = s.spotify_track_id
FROM public.curator_deal_songs s
WHERE dp.song_id = s.id
  AND dp.spotify_track_id IS NULL
  AND s.spotify_track_id IS NOT NULL;