UPDATE public.managed_playlists
SET archived_at = now()
WHERE spotify_playlist_id IN ('1aV20wle7grjeZB5FRw2iu', '6RZXNmbnfnofVtqeky06hl')
  AND archived_at IS NULL;