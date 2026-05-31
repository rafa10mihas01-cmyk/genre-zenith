INSERT INTO public.playlists (spotify_playlist_id, name, cover_url, followers, ownership, source)
VALUES
 ('BASE_PL_1', 'Funk 2025', 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop', 84230, 'external', 'external'),
 ('BASE_PL_2', 'Top Brasil 2026', 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=300&h=300&fit=crop', 152800, 'external', 'external'),
 ('ORG_PL_X', 'Descobertas', 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&h=300&fit=crop', 12450, 'external', 'external')
ON CONFLICT (spotify_playlist_id) DO UPDATE
  SET cover_url = EXCLUDED.cover_url,
      followers = EXCLUDED.followers,
      name      = EXCLUDED.name;

UPDATE public.campaign_playlist_collections
SET proof_screenshot_url = 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=800&h=500&fit=crop'
WHERE campaign_id = '8814fe7f-fa92-4a1b-afd7-f9202983f997';