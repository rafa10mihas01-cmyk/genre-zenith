DROP TRIGGER IF EXISTS trg_ccp_block_baseline ON public.curator_campaign_playlists;
DROP FUNCTION IF EXISTS public.block_baseline_playlist_registration();

CREATE OR REPLACE FUNCTION public.sync_campaign_curator_playlist_attribution(
  p_campaign_id uuid,
  p_playlist_id text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH candidates AS (
    SELECT
      cd.campaign_id,
      cd.curator_id,
      cd.id AS deal_id,
      cp.spotify_playlist_id AS playlist_id,
      COALESCE(
        NULLIF(cp.spotify_url, ''),
        'https://open.spotify.com/playlist/' || cp.spotify_playlist_id
      ) AS playlist_url,
      ROW_NUMBER() OVER (
        PARTITION BY cd.campaign_id, cp.spotify_playlist_id
        ORDER BY cd.created_at ASC, cp.added_at ASC NULLS LAST, cp.id ASC
      ) AS rn
    FROM public.curator_deals cd
    JOIN public.curator_playlists cp ON cp.deal_id = cd.id
    WHERE cd.campaign_id = p_campaign_id
      AND cd.curator_id IS NOT NULL
      AND cp.spotify_playlist_id IS NOT NULL
      AND (p_playlist_id IS NULL OR cp.spotify_playlist_id = p_playlist_id)
  ), ranked AS (
    SELECT * FROM candidates WHERE rn = 1
  ), with_first_seen AS (
    SELECT
      r.campaign_id,
      r.curator_id,
      r.deal_id,
      r.playlist_id,
      r.playlist_url,
      first_seen.collection_run_id,
      first_seen.captured_at
    FROM ranked r
    LEFT JOIN LATERAL (
      SELECT cpc.collection_run_id, cpc.captured_at
      FROM public.campaign_playlist_collections cpc
      WHERE cpc.campaign_id = r.campaign_id
        AND cpc.playlist_id = r.playlist_id
      ORDER BY cpc.captured_at ASC, cpc.created_at ASC
      LIMIT 1
    ) first_seen ON true
  ), inserted AS (
    INSERT INTO public.curator_campaign_playlists (
      campaign_id,
      curator_id,
      deal_id,
      playlist_id,
      playlist_url,
      status,
      matched_at,
      first_seen_collection_run_id
    )
    SELECT
      campaign_id,
      curator_id,
      deal_id,
      playlist_id,
      playlist_url,
      CASE WHEN collection_run_id IS NULL THEN 'pending_match' ELSE 'matched' END,
      captured_at,
      collection_run_id
    FROM with_first_seen
    ON CONFLICT (campaign_id, playlist_id) DO UPDATE
      SET curator_id = EXCLUDED.curator_id,
          deal_id = EXCLUDED.deal_id,
          playlist_url = EXCLUDED.playlist_url,
          status = CASE
            WHEN public.curator_campaign_playlists.status = 'matched' OR EXCLUDED.status = 'matched' THEN 'matched'
            ELSE EXCLUDED.status
          END,
          matched_at = COALESCE(public.curator_campaign_playlists.matched_at, EXCLUDED.matched_at),
          first_seen_collection_run_id = COALESCE(public.curator_campaign_playlists.first_seen_collection_run_id, EXCLUDED.first_seen_collection_run_id),
          updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_campaign_curator_playlist_attribution(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_sync_ccp_from_curator_playlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id uuid;
BEGIN
  SELECT cd.campaign_id
    INTO v_campaign_id
  FROM public.curator_deals cd
  WHERE cd.id = NEW.deal_id
    AND cd.campaign_id IS NOT NULL
    AND cd.curator_id IS NOT NULL;

  IF v_campaign_id IS NOT NULL AND NEW.spotify_playlist_id IS NOT NULL THEN
    PERFORM public.sync_campaign_curator_playlist_attribution(v_campaign_id, NEW.spotify_playlist_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_ccp_from_curator_playlist ON public.curator_playlists;
CREATE TRIGGER trg_sync_ccp_from_curator_playlist
  AFTER INSERT OR UPDATE OF deal_id, spotify_playlist_id, spotify_url
  ON public.curator_playlists
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_ccp_from_curator_playlist();

CREATE OR REPLACE FUNCTION public.tg_sync_ccp_from_curator_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.campaign_id IS NOT NULL AND NEW.curator_id IS NOT NULL THEN
    PERFORM public.sync_campaign_curator_playlist_attribution(NEW.campaign_id, NULL);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_ccp_from_curator_deal ON public.curator_deals;
CREATE TRIGGER trg_sync_ccp_from_curator_deal
  AFTER INSERT OR UPDATE OF campaign_id, curator_id
  ON public.curator_deals
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_ccp_from_curator_deal();

CREATE OR REPLACE FUNCTION public.tg_sync_ccp_from_collection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_campaign_curator_playlist_attribution(NEW.campaign_id, NEW.playlist_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_ccp_from_collection ON public.campaign_playlist_collections;
CREATE TRIGGER trg_sync_ccp_from_collection
  AFTER INSERT ON public.campaign_playlist_collections
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_ccp_from_collection();

SELECT public.sync_campaign_curator_playlist_attribution(campaign_id, NULL)
FROM (
  SELECT DISTINCT campaign_id
  FROM public.curator_deals
  WHERE campaign_id IS NOT NULL
    AND curator_id IS NOT NULL
) campaigns_to_sync;