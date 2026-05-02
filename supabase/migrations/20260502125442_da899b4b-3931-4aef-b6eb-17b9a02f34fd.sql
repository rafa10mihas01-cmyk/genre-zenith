-- Índices para performance em consultas por música
CREATE INDEX IF NOT EXISTS idx_curator_playlists_song_id
  ON public.curator_playlists(song_id)
  WHERE song_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_curator_deal_logs_song_id
  ON public.curator_deal_logs(song_id)
  WHERE song_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_curator_deal_songs_deal_position
  ON public.curator_deal_songs(deal_id, position);

-- Backfill: para todo log sem song_id, aponta para a música primária (position=0) do deal
UPDATE public.curator_deal_logs l
   SET song_id = s.id
  FROM public.curator_deal_songs s
 WHERE l.song_id IS NULL
   AND s.deal_id = l.deal_id
   AND s.position = 0;

-- Backfill: idem para playlists
UPDATE public.curator_playlists p
   SET song_id = s.id
  FROM public.curator_deal_songs s
 WHERE p.song_id IS NULL
   AND s.deal_id = p.deal_id
   AND s.position = 0;