-- Drop old unique index that incorrectly blocked the same playlist from
-- being linked to multiple songs in the same deal. The newer composite
-- index idx_curator_playlists_deal_song_playlist already enforces the
-- correct rule (no duplicate of the SAME song in the SAME playlist).
DROP INDEX IF EXISTS public.curator_playlists_deal_spid_unique;