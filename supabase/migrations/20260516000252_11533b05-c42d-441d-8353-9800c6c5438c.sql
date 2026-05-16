
-- A6 — Deduplica curator_playlists e blinda contra recorrência.
-- A7 — get_curator_deal_breakdown deixa de quebrar fora de sessão auth.

-- 1) Merge de duplicatas (deal_id, spotify_playlist_id).
--    Prioridade do keeper: match_status='curator' > maior nº de snapshots > mais antigo (added_at).
WITH ranked AS (
  SELECT
    cp.id,
    cp.deal_id,
    cp.spotify_playlist_id,
    cp.match_status,
    cp.added_at,
    (SELECT COUNT(*) FROM curator_deal_snapshots s WHERE s.playlist_id = cp.id) AS snap_count,
    ROW_NUMBER() OVER (
      PARTITION BY cp.deal_id, cp.spotify_playlist_id
      ORDER BY
        (cp.match_status = 'curator') DESC,
        (SELECT COUNT(*) FROM curator_deal_snapshots s WHERE s.playlist_id = cp.id) DESC,
        cp.added_at ASC
    ) AS rn
  FROM curator_playlists cp
  WHERE cp.spotify_playlist_id IS NOT NULL
),
keepers AS (
  SELECT deal_id, spotify_playlist_id, id AS keeper_id FROM ranked WHERE rn = 1
),
losers AS (
  SELECT r.id AS loser_id, k.keeper_id
  FROM ranked r
  JOIN keepers k ON k.deal_id = r.deal_id AND k.spotify_playlist_id = r.spotify_playlist_id
  WHERE r.rn > 1
)
-- 1a) Aponta snapshots dos losers para o keeper.
UPDATE curator_deal_snapshots s
SET playlist_id = l.keeper_id
FROM losers l
WHERE s.playlist_id = l.loser_id;

-- 1b) Apaga os losers (agora sem snapshots).
WITH ranked AS (
  SELECT
    cp.id,
    cp.deal_id,
    cp.spotify_playlist_id,
    ROW_NUMBER() OVER (
      PARTITION BY cp.deal_id, cp.spotify_playlist_id
      ORDER BY
        (cp.match_status = 'curator') DESC,
        (SELECT COUNT(*) FROM curator_deal_snapshots s WHERE s.playlist_id = cp.id) DESC,
        cp.added_at ASC
    ) AS rn
  FROM curator_playlists cp
  WHERE cp.spotify_playlist_id IS NOT NULL
)
DELETE FROM curator_playlists cp
USING ranked r
WHERE cp.id = r.id AND r.rn > 1;

-- 2) Blindagem definitiva contra duplicata.
CREATE UNIQUE INDEX IF NOT EXISTS curator_playlists_deal_spotify_unique
  ON public.curator_playlists (deal_id, spotify_playlist_id)
  WHERE spotify_playlist_id IS NOT NULL;

-- 3) A7 — get_curator_deal_breakdown: usar has_team_access() ou service_role
--    em vez de auth.uid() direto (que quebra em contextos sem JWT).
CREATE OR REPLACE FUNCTION public.get_curator_deal_breakdown(p_deal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_baseline bigint;
  v_target bigint;
  v_result jsonb;
  v_is_service boolean := (current_setting('request.jwt.claim.role', true) = 'service_role')
                          OR (auth.role() = 'service_role');
BEGIN
  SELECT user_id, COALESCE(baseline_plays,0), COALESCE(target_plays,0)
    INTO v_owner, v_baseline, v_target
  FROM public.curator_deals
  WHERE id = p_deal_id;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('error','deal_not_found');
  END IF;

  -- Permite: dono do deal, qualquer membro do time, ou service_role.
  IF NOT v_is_service
     AND v_owner IS DISTINCT FROM auth.uid()
     AND NOT public.has_team_access() THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (s.playlist_id)
      s.playlist_id, s.plays, s.captured_at
    FROM public.curator_deal_snapshots s
    WHERE s.deal_id = p_deal_id AND s.is_baseline = false
    ORDER BY s.playlist_id, s.captured_at DESC
  ),
  classified AS (
    SELECT l.playlist_id, l.plays, COALESCE(p.match_status, 'organic') AS match_status
    FROM latest l
    JOIN public.curator_playlists p ON p.id = l.playlist_id
    WHERE p.is_baseline = false
  ),
  agg AS (
    SELECT match_status, COUNT(*)::int AS playlists, COALESCE(SUM(plays),0)::bigint AS plays
    FROM classified GROUP BY match_status
  )
  SELECT jsonb_build_object(
    'curator', jsonb_build_object(
      'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='curator'),0),
      'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='curator'),0)
    ),
    'ecosystem', jsonb_build_object(
      'editorial', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='editorial'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='editorial'),0)
      ),
      'algorithmic', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='algorithmic'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='algorithmic'),0)
      ),
      'organic', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='organic'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='organic'),0)
      ),
      'suspicious', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='suspicious'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='suspicious'),0)
      )
    ),
    'total', jsonb_build_object(
      'playlists', COALESCE((SELECT SUM(playlists) FROM agg),0),
      'plays',     COALESCE((SELECT SUM(plays)     FROM agg),0)
    ),
    'baseline_plays', v_baseline,
    'target_plays',   v_target
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
