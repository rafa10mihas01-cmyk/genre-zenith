CREATE OR REPLACE FUNCTION public.ccp_curator_only_safe_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  is_curator_owner boolean;
BEGIN
  -- Bypass transacional usado apenas por funções internas SECURITY DEFINER
  -- (auto-match/atribuição da engine). Clientes não têm caminho para setar isso
  -- pela API comum e a flag expira no fim da transação.
  IF current_setting('app.ccp_internal_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- If caller has team access, allow anything
  IF public.has_team_access() THEN
    RETURN NEW;
  END IF;

  -- If caller is the curator owner, only allow safe field changes
  SELECT EXISTS (
    SELECT 1 FROM public.curators c
    WHERE c.id = NEW.curator_id AND c.user_id = auth.uid()
  ) INTO is_curator_owner;

  IF NOT is_curator_owner THEN
    RAISE EXCEPTION 'not allowed to update this ccp row';
  END IF;

  -- Block changes to protected fields
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.curator_id IS DISTINCT FROM OLD.curator_id
     OR NEW.deal_id IS DISTINCT FROM OLD.deal_id
     OR NEW.playlist_id IS DISTINCT FROM OLD.playlist_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.matched_at IS DISTINCT FROM OLD.matched_at
     OR NEW.first_seen_collection_run_id IS DISTINCT FROM OLD.first_seen_collection_run_id
     OR NEW.baseline_conflict_at IS DISTINCT FROM OLD.baseline_conflict_at
     OR NEW.baseline_conflict_source IS DISTINCT FROM OLD.baseline_conflict_source
     OR NEW.excluded_from_kpis IS DISTINCT FROM OLD.excluded_from_kpis
     OR NEW.registered_at IS DISTINCT FROM OLD.registered_at
  THEN
    RAISE EXCEPTION 'curators may only edit playlist_url on curator_campaign_playlists';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_ccp_auto_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM set_config('app.ccp_internal_write', 'on', true);

  UPDATE public.curator_campaign_playlists
     SET status = 'matched',
         matched_at = COALESCE(matched_at, now()),
         first_seen_collection_run_id = COALESCE(first_seen_collection_run_id, NEW.collection_run_id)
   WHERE campaign_id = NEW.campaign_id
     AND playlist_id = NEW.playlist_id
     AND status = 'pending_match';
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_campaign_curator_playlist_attribution(p_campaign_id uuid, p_playlist_id text DEFAULT NULL::text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  PERFORM set_config('app.ccp_internal_write', 'on', true);

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
$function$;

CREATE OR REPLACE FUNCTION public.match_curator_campaign_playlists(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_promoted int := 0;
BEGIN
  PERFORM set_config('app.ccp_internal_write', 'on', true);

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
     AND COALESCE(cp.is_observational, false) = false
    WHERE ccp.campaign_id = p_campaign_id
      AND ccp.status = 'pending_match'
      AND COALESCE(ccp.excluded_from_kpis, false) = false
      AND NOT EXISTS (
        SELECT 1
        FROM public.managed_playlists mp
        WHERE mp.spotify_playlist_id = ccp.playlist_id
      )
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
$function$;