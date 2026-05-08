-- Permite mesma playlist em músicas diferentes do mesmo deal.
-- Bloqueia apenas duplicata dentro da mesma (deal, música, playlist).
DROP INDEX IF EXISTS public.idx_curator_playlists_deal_playlist;
DROP INDEX IF EXISTS public.curator_playlists_deal_spotify_unique;

CREATE UNIQUE INDEX idx_curator_playlists_deal_song_playlist
ON public.curator_playlists (deal_id, COALESCE(song_id, '00000000-0000-0000-0000-000000000000'::uuid), spotify_playlist_id)
WHERE spotify_playlist_id IS NOT NULL;