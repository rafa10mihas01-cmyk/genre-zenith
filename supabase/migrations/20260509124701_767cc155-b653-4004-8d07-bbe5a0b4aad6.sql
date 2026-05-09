-- Phase 2: Dedupe curator_playlists by (deal_id, spotify_playlist_id)
-- Keeps the oldest row, re-points snapshots, merges max stream counters, deletes duplicates.

DO $$
DECLARE
  grp RECORD;
  survivor_id uuid;
  dup_ids uuid[];
  max_7d bigint;
  max_28d bigint;
  max_total bigint;
BEGIN
  FOR grp IN
    SELECT deal_id, spotify_playlist_id
    FROM public.curator_playlists
    WHERE spotify_playlist_id IS NOT NULL
    GROUP BY deal_id, spotify_playlist_id
    HAVING COUNT(*) > 1
  LOOP
    -- Pick survivor (oldest added_at)
    SELECT id INTO survivor_id
    FROM public.curator_playlists
    WHERE deal_id = grp.deal_id
      AND spotify_playlist_id = grp.spotify_playlist_id
    ORDER BY added_at ASC, id ASC
    LIMIT 1;

    -- Collect duplicate ids (everyone except survivor)
    SELECT array_agg(id) INTO dup_ids
    FROM public.curator_playlists
    WHERE deal_id = grp.deal_id
      AND spotify_playlist_id = grp.spotify_playlist_id
      AND id <> survivor_id;

    -- Compute max counters across full group
    SELECT MAX(streams_7d), MAX(streams_28d), MAX(streams_total)
      INTO max_7d, max_28d, max_total
    FROM public.curator_playlists
    WHERE deal_id = grp.deal_id
      AND spotify_playlist_id = grp.spotify_playlist_id;

    -- Re-point snapshots
    UPDATE public.curator_deal_snapshots
       SET playlist_id = survivor_id
     WHERE playlist_id = ANY(dup_ids);

    -- Update survivor counters
    UPDATE public.curator_playlists
       SET streams_7d = COALESCE(max_7d, 0),
           streams_28d = COALESCE(max_28d, 0),
           streams_total = COALESCE(max_total, 0)
     WHERE id = survivor_id;

    -- Delete duplicates
    DELETE FROM public.curator_playlists
     WHERE id = ANY(dup_ids);
  END LOOP;
END $$;

-- Prevent recurrence: unique (deal_id, spotify_playlist_id) when spotify_playlist_id is set
CREATE UNIQUE INDEX IF NOT EXISTS curator_playlists_deal_spid_unique
  ON public.curator_playlists (deal_id, spotify_playlist_id)
  WHERE spotify_playlist_id IS NOT NULL;