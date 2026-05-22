CREATE OR REPLACE FUNCTION public.resolve_client_token(_token TEXT)
RETURNS TABLE(deal_id UUID, song_id UUID, has_spotify BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH song_match AS (
    SELECT
      d.id AS deal_id,
      s.id AS song_id,
      (d.spotify_owner_id IS NOT NULL) AS has_spotify
    FROM public.curator_deal_songs s
    JOIN public.curator_deals d ON d.id = s.deal_id
    WHERE s.client_token = _token OR s.slug = _token
    LIMIT 1
  ),
  deal_match AS (
    SELECT
      d.id AS deal_id,
      NULL::uuid AS song_id,
      (d.spotify_owner_id IS NOT NULL) AS has_spotify
    FROM public.curator_deals d
    WHERE d.client_token = _token OR d.slug = _token
    LIMIT 1
  )
  SELECT * FROM song_match
  UNION ALL
  SELECT * FROM deal_match WHERE NOT EXISTS (SELECT 1 FROM song_match)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_client_token(TEXT) TO anon, authenticated;