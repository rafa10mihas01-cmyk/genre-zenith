-- 1) curator_playlists faltantes (com spotify_url derivada do id se preciso)
INSERT INTO public.curator_playlists (
  deal_id, song_id, spotify_playlist_id, spotify_url, playlist_name,
  spotify_owner_name, canonical_playlist_id, attribution_method
)
SELECT DISTINCT ON (r.deal_id, COALESCE(r.song_id, '00000000-0000-0000-0000-000000000000'::uuid), r.playlist_spotify_id)
  r.deal_id,
  r.song_id,
  r.playlist_spotify_id,
  COALESCE(r.playlist_url, 'https://open.spotify.com/playlist/' || r.playlist_spotify_id),
  r.playlist_name,
  r.owner_name,
  r.matched_playlist_id,
  'label_spreadsheet'
FROM public.label_spreadsheet_rows r
WHERE r.matched_playlist_id IS NOT NULL
  AND r.playlist_spotify_id IS NOT NULL
ON CONFLICT (deal_id, COALESCE(song_id, '00000000-0000-0000-0000-000000000000'::uuid), spotify_playlist_id)
WHERE spotify_playlist_id IS NOT NULL
DO NOTHING;

-- 2) curator_deal_snapshots
INSERT INTO public.curator_deal_snapshots (
  deal_id, song_id, playlist_id, plays, captured_at, source,
  is_baseline, notes, ai_raw
)
SELECT
  r.deal_id, r.song_id, cp.id, r.streams, u.created_at, 'label_spreadsheet',
  COALESCE(u.is_baseline, false),
  r.playlist_name || COALESCE(' (' || r.owner_name || ')', ''),
  jsonb_build_object(
    'source','label_spreadsheet','upload_id',u.id,
    'playlist_name',r.playlist_name,'playlist_spotify_id',r.playlist_spotify_id,
    'owner_name',r.owner_name,'managed_playlist_id',r.matched_playlist_id,
    'backfill',true
  )
FROM public.label_spreadsheet_rows r
JOIN public.label_spreadsheet_uploads u ON u.id = r.upload_id
JOIN public.curator_playlists cp
  ON cp.deal_id = r.deal_id
 AND cp.spotify_playlist_id = r.playlist_spotify_id
 AND COALESCE(cp.song_id, '00000000-0000-0000-0000-000000000000'::uuid)
   = COALESCE(r.song_id, '00000000-0000-0000-0000-000000000000'::uuid)
WHERE r.matched_playlist_id IS NOT NULL
  AND r.playlist_spotify_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.curator_deal_snapshots s
    WHERE s.deal_id = r.deal_id AND s.playlist_id = cp.id
      AND s.captured_at = u.created_at AND s.source = 'label_spreadsheet'
  );

-- 3) delivery_proofs
INSERT INTO public.delivery_proofs (
  deal_id, song_id, playlist_id, spotify_playlist_id,
  playlist_name, track_name, plays_total, position_in_playlist,
  source, captured_at, spotify_track_id
)
SELECT
  r.deal_id, r.song_id, cp.id, r.playlist_spotify_id,
  r.playlist_name, c.track_name, r.streams, r.position,
  'label_spreadsheet', u.created_at, c.spotify_track_id
FROM public.label_spreadsheet_rows r
JOIN public.label_spreadsheet_uploads u ON u.id = r.upload_id
JOIN public.campaigns c ON c.deal_id = r.deal_id
JOIN public.curator_playlists cp
  ON cp.deal_id = r.deal_id
 AND cp.spotify_playlist_id = r.playlist_spotify_id
 AND COALESCE(cp.song_id, '00000000-0000-0000-0000-000000000000'::uuid)
   = COALESCE(r.song_id, '00000000-0000-0000-0000-000000000000'::uuid)
WHERE r.matched_playlist_id IS NOT NULL
  AND r.song_id IS NOT NULL
  AND r.playlist_spotify_id IS NOT NULL
  AND c.track_name IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.delivery_proofs dp
    WHERE dp.deal_id = r.deal_id AND dp.playlist_id = cp.id
      AND dp.captured_at = u.created_at AND dp.source = 'label_spreadsheet'
  );

-- 4) total_delivered
UPDATE public.campaigns c
SET total_delivered = sub.total
FROM (
  SELECT r.deal_id, SUM(r.streams)::bigint AS total
  FROM public.label_spreadsheet_rows r
  GROUP BY r.deal_id
) sub
WHERE c.deal_id = sub.deal_id;