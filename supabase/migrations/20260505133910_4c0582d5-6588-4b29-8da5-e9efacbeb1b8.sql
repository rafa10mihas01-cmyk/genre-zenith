-- Remove playlists algorítmicas/ouvintes do Spotify capturadas erroneamente
WITH lixo AS (
  SELECT cp.id
  FROM curator_playlists cp
  WHERE cp.spotify_playlist_id IS NULL
    AND (
      lower(coalesce(cp.spotify_owner_name, '')) = 'spotify'
      OR lower(trim(cp.playlist_name)) IN (
        'radio','mixes','daylist','smart shuffle','on repeat','blend',
        'your dj','discover weekly','release radar','made for you',
        'repeat rewind','your top songs','niche mixes','uniquely yours'
      )
      OR lower(cp.playlist_name) ~ '\b(daily mix|mix [0-9]+|on repeat|smart shuffle)\b'
    )
)
DELETE FROM curator_deal_snapshots WHERE playlist_id IN (SELECT id FROM lixo);

WITH lixo AS (
  SELECT cp.id
  FROM curator_playlists cp
  WHERE cp.spotify_playlist_id IS NULL
    AND (
      lower(coalesce(cp.spotify_owner_name, '')) = 'spotify'
      OR lower(trim(cp.playlist_name)) IN (
        'radio','mixes','daylist','smart shuffle','on repeat','blend',
        'your dj','discover weekly','release radar','made for you',
        'repeat rewind','your top songs','niche mixes','uniquely yours'
      )
      OR lower(cp.playlist_name) ~ '\b(daily mix|mix [0-9]+|on repeat|smart shuffle)\b'
    )
)
DELETE FROM curator_playlists WHERE id IN (SELECT id FROM lixo);