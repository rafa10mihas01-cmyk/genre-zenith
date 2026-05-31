
DELETE FROM public.campaign_playlist_collections
 WHERE campaign_id='8814fe7f-fa92-4a1b-afd7-f9202983f997'
   AND playlist_id='37i9dQZF1DXTESTAUTOMATCH01';

DELETE FROM public.curator_campaign_playlists
 WHERE playlist_id='37i9dQZF1DXTESTAUTOMATCH01';

UPDATE public.campaigns
   SET baseline_status='pending', baseline_captured_at=NULL
 WHERE id='8814fe7f-fa92-4a1b-afd7-f9202983f997';
