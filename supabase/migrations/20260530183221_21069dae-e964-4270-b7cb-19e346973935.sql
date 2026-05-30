-- Função inteligente que decide se um deal coleta via bot ou planilha,
-- baseada em "tem como printar o S4A do artista?" e NÃO em "tem owner da playlist?".
-- Regra:
--   bot se: o deal (ou alguma de suas músicas) tem spotify_track_id resolvível
--           OU o cliente vinculado (via campaign) tem spotify_artist_id.
--   spreadsheet caso contrário.
CREATE OR REPLACE FUNCTION public.infer_collection_mode(p_deal_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_track boolean := false;
  has_artist boolean := false;
BEGIN
  IF p_deal_id IS NULL THEN RETURN 'spreadsheet'; END IF;

  -- Alguma música do deal tem track id ou URL do Spotify?
  SELECT EXISTS (
    SELECT 1 FROM public.curator_deal_songs
     WHERE deal_id = p_deal_id
       AND (spotify_track_id IS NOT NULL OR song_spotify_url IS NOT NULL)
  ) INTO has_track;

  -- Cliente da campanha vinculada tem spotify_artist_id?
  SELECT EXISTS (
    SELECT 1
      FROM public.curator_deals cd
      JOIN public.campaigns ca ON ca.id = cd.campaign_id
      JOIN public.clients   cl ON cl.id = ca.client_id
     WHERE cd.id = p_deal_id
       AND cl.spotify_artist_id IS NOT NULL
  ) INTO has_artist;

  IF has_track OR has_artist THEN
    RETURN 'bot';
  END IF;
  RETURN 'spreadsheet';
END;
$$;

-- Backfill idempotente: só promove spreadsheet → bot quando há como coletar.
-- Nunca rebaixa bot → spreadsheet (preserva decisão manual existente).
UPDATE public.curator_deals
   SET collection_mode = 'bot'
 WHERE collection_mode = 'spreadsheet'
   AND public.infer_collection_mode(id) = 'bot'
   AND closed_at IS NULL;