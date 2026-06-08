
-- 1) Drop the OLD 3-arg overload to eliminate ambiguity with the 4-arg version
DROP FUNCTION IF EXISTS public.ingest_campaign_collection_batch(uuid, text, jsonb);

-- 2) Auto-matcher: promotes pending_match -> matched when a curator_playlist
--    (match_status='curator') exists for the same curator in any deal of this campaign.
CREATE OR REPLACE FUNCTION public.match_curator_campaign_playlists(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promoted int := 0;
BEGIN
  WITH promotable AS (
    SELECT DISTINCT ccp.curator_id, ccp.playlist_id
    FROM public.curator_campaign_playlists ccp
    JOIN public.curator_deals cd
      ON cd.campaign_id = ccp.campaign_id
     AND cd.curator_id  = ccp.curator_id
    JOIN public.curator_playlists cp
      ON cp.deal_id = cd.id
     AND cp.spotify_playlist_id = ccp.playlist_id
     AND cp.match_status = 'curator'
    WHERE ccp.campaign_id = p_campaign_id
      AND ccp.status = 'pending_match'
  ),
  upd AS (
    UPDATE public.curator_campaign_playlists ccp
       SET status = 'matched'
      FROM promotable p
     WHERE ccp.campaign_id = p_campaign_id
       AND ccp.curator_id  = p.curator_id
       AND ccp.playlist_id = p.playlist_id
       AND ccp.status      = 'pending_match'
    RETURNING 1
  )
  SELECT count(*) INTO v_promoted FROM upd;

  RETURN jsonb_build_object('campaign_id', p_campaign_id, 'promoted', v_promoted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_curator_campaign_playlists(uuid) TO authenticated, service_role;
