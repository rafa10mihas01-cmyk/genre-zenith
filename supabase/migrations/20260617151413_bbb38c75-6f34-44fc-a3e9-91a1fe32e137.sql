-- Fase 1.A.0: RPC oficial única de leitura da baseline da campanha
-- Durante a transição, faz UNION das 2 fontes legadas (campaign_playlist_collections + curator_deal_baseline_playlists).
-- Após 1.A.1 (migração de dados), esta função será simplificada para ler só de campaign_playlist_collections.
-- Frontend e edge functions devem usar APENAS esta RPC. Nenhuma consulta direta às tabelas físicas é permitida.

CREATE OR REPLACE FUNCTION public.get_campaign_baseline(
  p_campaign_id uuid,
  p_spotify_playlist_id text DEFAULT NULL
)
RETURNS TABLE (
  campaign_id uuid,
  spotify_playlist_id text,
  playlist_name text,
  baseline_plays bigint,
  captured_at timestamptz,
  song_id uuid,
  deal_id uuid,
  source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Fonte oficial (nova): campaign_playlist_collections com is_baseline=true
  SELECT
    cpc.campaign_id,
    cpc.playlist_id AS spotify_playlist_id,
    cpc.playlist_name_at_capture AS playlist_name,
    cpc.plays_7d AS baseline_plays,
    cpc.captured_at,
    NULL::uuid AS song_id,
    c.deal_id,
    'campaign_playlist_collections'::text AS source
  FROM public.campaign_playlist_collections cpc
  JOIN public.campaigns c ON c.id = cpc.campaign_id
  WHERE cpc.campaign_id = p_campaign_id
    AND cpc.is_baseline = true
    AND cpc.excluded = false
    AND (p_spotify_playlist_id IS NULL OR cpc.playlist_id = p_spotify_playlist_id)

  UNION ALL

  -- Fonte legada (em migração — será removida na Fase 1.A.1):
  -- só retorna se NÃO existir equivalente na fonte oficial pra essa playlist nessa campanha
  SELECT
    c.id AS campaign_id,
    cdbp.spotify_playlist_id,
    cdbp.playlist_name,
    NULL::bigint AS baseline_plays,
    cdbp.captured_at,
    cdbp.song_id,
    cdbp.deal_id,
    'curator_deal_baseline_playlists'::text AS source
  FROM public.curator_deal_baseline_playlists cdbp
  JOIN public.campaigns c ON c.deal_id = cdbp.deal_id
  WHERE c.id = p_campaign_id
    AND (p_spotify_playlist_id IS NULL OR cdbp.spotify_playlist_id = p_spotify_playlist_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.campaign_playlist_collections cpc2
      WHERE cpc2.campaign_id = c.id
        AND cpc2.playlist_id = cdbp.spotify_playlist_id
        AND cpc2.is_baseline = true
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_campaign_baseline(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_campaign_baseline(uuid, text) IS
  'Fase 1 — porta oficial única de leitura da baseline de campanha. Frontend e edge functions devem usar EXCLUSIVAMENTE esta função; nenhuma consulta direta a campaign_playlist_collections.is_baseline ou curator_deal_baseline_playlists é permitida em código novo.';