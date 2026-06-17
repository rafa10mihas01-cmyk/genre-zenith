
-- Fase 1.A.1 — eliminar todas as dependências SQL de curator_deal_baseline_playlists.
-- Mantém a tabela viva nesta migração; o DROP acontece somente após auditor AFTER=0.

-- 1) Triggers e funções de gatilho que mantêm a tabela legada em sincronia.
DROP TRIGGER IF EXISTS trg_sync_deal_campaign_baseline_from_deal ON public.curator_deals;
DROP TRIGGER IF EXISTS trg_sync_deal_campaign_baseline_from_song ON public.curator_deal_songs;
DROP FUNCTION IF EXISTS public.tg_sync_deal_campaign_baseline_from_deal();
DROP FUNCTION IF EXISTS public.tg_sync_deal_campaign_baseline_from_song();
DROP FUNCTION IF EXISTS public.sync_deal_campaign_baseline(uuid);

-- 2) Helpers legados — só liam da tabela antiga.
DROP FUNCTION IF EXISTS public.is_playlist_in_deal_baseline(uuid, text);
DROP FUNCTION IF EXISTS public.is_playlist_in_deal_baseline(uuid, text, uuid);

-- 3) Regra "playlist da baseline não pode ser cadastrada pelo curador"
--    reescrita para ler da fonte oficial via deal → campanha.
CREATE OR REPLACE FUNCTION public.enforce_curator_playlist_baseline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign_id uuid;
  v_in_baseline boolean;
BEGIN
  IF NEW.is_baseline = true OR NEW.spotify_playlist_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT d.campaign_id INTO v_campaign_id
  FROM public.curator_deals d
  WHERE d.id = NEW.deal_id;

  -- Sem campanha vinculada: regra oficial diz "não existe baseline sem campanha".
  -- Nada a bloquear.
  IF v_campaign_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(
    SELECT 1
      FROM public.campaign_playlist_collections cpc
     WHERE cpc.campaign_id = v_campaign_id
       AND cpc.is_baseline = true
       AND COALESCE(cpc.excluded, false) = false
       AND cpc.playlist_id = NEW.spotify_playlist_id
  ) INTO v_in_baseline;

  IF v_in_baseline THEN
    RAISE EXCEPTION 'Essa playlist já existia no baseline desta campanha e não pode ser atribuída ao curador.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.attribution_method IS NULL OR NEW.attribution_method = 'baseline_observed' THEN
    NEW.attribution_method := 'baseline_zero';
    NEW.attribution_reason := COALESCE(NEW.attribution_reason, 'not_in_campaign_baseline');
  END IF;

  RETURN NEW;
END;
$function$;

-- 4) fn_playlist_delivery_accumulated: substitui o ramo legado da CTE `allowed`
--    pela leitura oficial (`campaign_playlist_collections` is_baseline=true).
CREATE OR REPLACE FUNCTION public.fn_playlist_delivery_accumulated(p_campaign_id uuid)
RETURNS TABLE(playlist_id text, delivery_accumulated bigint, current_reading bigint, last_reading_at timestamp with time zone, readings_count integer, last_import_delta bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH canon AS MATERIALIZED (
    SELECT canonical_window_days FROM public.campaigns WHERE id = p_campaign_id
  ),
  allowed AS MATERIALIZED (
    SELECT ccp.playlist_id FROM public.curator_campaign_playlists ccp
     WHERE ccp.campaign_id = p_campaign_id
       AND COALESCE(ccp.excluded_from_kpis, false) = false
    UNION
    SELECT mp.spotify_playlist_id
      FROM public.campaign_eco_allocations a
      JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
     WHERE a.campaign_id = p_campaign_id
       AND mp.spotify_playlist_id IS NOT NULL
    UNION
    -- Fase 1.A.1: baseline lida da fonte oficial (campaign_playlist_collections).
    SELECT cpc.playlist_id
      FROM public.campaign_playlist_collections cpc
     WHERE cpc.campaign_id = p_campaign_id
       AND cpc.is_baseline = true
       AND COALESCE(cpc.excluded, false) = false
       AND cpc.playlist_id IS NOT NULL
  ),
  valid AS MATERIALIZED (
    SELECT c.playlist_id, c.plays_7d, c.is_baseline, c.captured_at,
           COALESCE(u.created_at, c.created_at) AS up_created,
           COALESCE(u.window_kind,
             CASE WHEN c.upload_id IS NULL THEN 'last_7d' ELSE 'unknown' END
           ) AS window_kind
      FROM public.campaign_playlist_collections c
      LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
     WHERE c.campaign_id = p_campaign_id
       AND COALESCE(c.excluded, false) = false
       AND (u.id IS NULL OR u.quarantined_at IS NULL)
       AND c.window_days = (SELECT canonical_window_days FROM canon)
       AND (c.is_baseline = true OR c.playlist_id IN (SELECT a2.playlist_id FROM allowed a2))
  ),
  has_baseline AS MATERIALIZED (
    SELECT v.playlist_id, BOOL_OR(v.is_baseline) AS has_bl
      FROM valid v GROUP BY v.playlist_id
  ),
  ordered AS MATERIALIZED (
    SELECT v.playlist_id, v.plays_7d, v.captured_at, v.window_kind, hb.has_bl,
           ROW_NUMBER() OVER (PARTITION BY v.playlist_id ORDER BY v.up_created, v.captured_at) AS rn,
           LAG(v.plays_7d) OVER (PARTITION BY v.playlist_id ORDER BY v.up_created, v.captured_at) AS prev_plays
      FROM valid v
      JOIN has_baseline hb USING (playlist_id)
  ),
  with_delta AS MATERIALIZED (
    SELECT o.playlist_id, o.plays_7d, o.captured_at, o.rn, o.prev_plays, o.has_bl, o.window_kind,
           CASE
             WHEN o.window_kind IN ('last_24h','last_day')
               THEN o.plays_7d::bigint
             WHEN o.rn = 1 AND o.has_bl     THEN 0::bigint
             WHEN o.rn = 1 AND NOT o.has_bl THEN o.plays_7d::bigint
             ELSE GREATEST(0, o.plays_7d - COALESCE(o.prev_plays, o.plays_7d))::bigint
           END AS delta_pos
      FROM ordered o
  ),
  totals AS MATERIALIZED (
    SELECT w.playlist_id,
           SUM(w.delta_pos)::bigint AS delivery_accumulated,
           MAX(w.plays_7d)::bigint  AS current_reading,
           MAX(w.captured_at)       AS last_reading_at,
           COUNT(*)::int            AS readings_count,
           MAX(w.rn)                AS max_rn
      FROM with_delta w GROUP BY w.playlist_id
  ),
  last_row AS MATERIALIZED (
    SELECT w.playlist_id,
           CASE
             WHEN w.window_kind IN ('last_24h','last_day')
               THEN w.plays_7d::bigint
             WHEN w.rn = 1 AND NOT w.has_bl THEN w.plays_7d::bigint
             WHEN w.prev_plays IS NULL      THEN NULL
             ELSE GREATEST(0, w.plays_7d - w.prev_plays)::bigint
           END AS last_import_delta
      FROM with_delta w
      JOIN totals t ON t.playlist_id = w.playlist_id AND t.max_rn = w.rn
  )
  SELECT t.playlist_id,
         t.delivery_accumulated,
         t.current_reading,
         t.last_reading_at,
         t.readings_count,
         lr.last_import_delta
    FROM totals t
    LEFT JOIN last_row lr ON lr.playlist_id = t.playlist_id;
END;
$function$;

-- 5) RPC oficial — remove a união com a tabela legada.
CREATE OR REPLACE FUNCTION public.get_campaign_baseline(p_campaign_id uuid, p_spotify_playlist_id text DEFAULT NULL::text)
RETURNS TABLE(campaign_id uuid, spotify_playlist_id text, playlist_name text, baseline_plays bigint, captured_at timestamp with time zone, song_id uuid, deal_id uuid, source text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Fase 1.A.1: fonte única oficial. Tabela legada removida.
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
    AND COALESCE(cpc.excluded, false) = false
    AND (p_spotify_playlist_id IS NULL OR cpc.playlist_id = p_spotify_playlist_id);
$function$;
