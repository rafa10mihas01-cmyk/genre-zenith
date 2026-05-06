-- ============================================================
-- FASE 3 — Blindagem estrutural e integridade
-- ============================================================

-- 1) Limpeza de órfãos antes das FKs
DELETE FROM public.curator_deal_snapshots s
 WHERE NOT EXISTS (SELECT 1 FROM public.curator_playlists p WHERE p.id = s.playlist_id);

UPDATE public.curator_deal_snapshots s
   SET song_id = NULL
 WHERE song_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.curator_deal_songs g WHERE g.id = s.song_id);

-- 2) FKs formais em snapshots
ALTER TABLE public.curator_deal_snapshots
  DROP CONSTRAINT IF EXISTS curator_deal_snapshots_deal_id_fkey,
  DROP CONSTRAINT IF EXISTS curator_deal_snapshots_playlist_id_fkey,
  DROP CONSTRAINT IF EXISTS curator_deal_snapshots_song_id_fkey;

ALTER TABLE public.curator_deal_snapshots
  ADD CONSTRAINT curator_deal_snapshots_deal_id_fkey
    FOREIGN KEY (deal_id) REFERENCES public.curator_deals(id) ON DELETE CASCADE,
  ADD CONSTRAINT curator_deal_snapshots_playlist_id_fkey
    FOREIGN KEY (playlist_id) REFERENCES public.curator_playlists(id) ON DELETE CASCADE,
  ADD CONSTRAINT curator_deal_snapshots_song_id_fkey
    FOREIGN KEY (song_id) REFERENCES public.curator_deal_songs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_snapshots_deal      ON public.curator_deal_snapshots(deal_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_playlist  ON public.curator_deal_snapshots(playlist_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_song      ON public.curator_deal_snapshots(song_id);

-- 3) Estados formais do deal
ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'awaiting_playlists';

ALTER TABLE public.curator_deals
  DROP CONSTRAINT IF EXISTS curator_deals_state_check;
ALTER TABLE public.curator_deals
  ADD CONSTRAINT curator_deals_state_check
  CHECK (state IN ('awaiting_playlists','collecting','active','paused','completed','closed'));

-- 4) Função: recomputar estado do deal
CREATE OR REPLACE FUNCTION public.recompute_curator_deal_state(p_deal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed_at timestamptz;
  v_closed_status text;
  v_has_curator_pl boolean;
  v_has_snapshot boolean;
  v_new_state text;
BEGIN
  SELECT closed_at, closed_status INTO v_closed_at, v_closed_status
    FROM public.curator_deals WHERE id = p_deal_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_closed_at IS NOT NULL THEN
    v_new_state := CASE WHEN v_closed_status = 'completed' THEN 'completed' ELSE 'closed' END;
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM public.curator_playlists
       WHERE deal_id = p_deal_id AND match_status = 'curator'
    ) INTO v_has_curator_pl;

    IF NOT v_has_curator_pl THEN
      v_new_state := 'awaiting_playlists';
    ELSE
      SELECT EXISTS(
        SELECT 1 FROM public.curator_deal_snapshots s
         JOIN public.curator_playlists p ON p.id = s.playlist_id
         WHERE s.deal_id = p_deal_id
           AND p.match_status = 'curator'
           AND s.is_baseline = false
      ) INTO v_has_snapshot;
      v_new_state := CASE WHEN v_has_snapshot THEN 'active' ELSE 'collecting' END;
    END IF;
  END IF;

  UPDATE public.curator_deals
     SET state = v_new_state
   WHERE id = p_deal_id AND state IS DISTINCT FROM v_new_state
     AND state <> 'paused'; -- paused é manual; só sai se for por close
END;
$$;

-- 5) Triggers que disparam recompute
CREATE OR REPLACE FUNCTION public.trg_recompute_deal_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id uuid;
BEGIN
  v_deal_id := COALESCE(NEW.deal_id, OLD.deal_id);
  IF v_deal_id IS NOT NULL THEN
    PERFORM public.recompute_curator_deal_state(v_deal_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_curator_playlists_recompute ON public.curator_playlists;
CREATE TRIGGER trg_curator_playlists_recompute
AFTER INSERT OR UPDATE OF match_status OR DELETE ON public.curator_playlists
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_deal_state();

DROP TRIGGER IF EXISTS trg_curator_snapshots_recompute ON public.curator_deal_snapshots;
CREATE TRIGGER trg_curator_snapshots_recompute
AFTER INSERT ON public.curator_deal_snapshots
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_deal_state();

CREATE OR REPLACE FUNCTION public.trg_curator_deals_close_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.closed_at IS NOT NULL AND OLD.closed_at IS NULL THEN
    NEW.state := CASE WHEN NEW.closed_status = 'completed' THEN 'completed' ELSE 'closed' END;
  ELSIF NEW.closed_at IS NULL AND OLD.closed_at IS NOT NULL THEN
    NEW.state := 'awaiting_playlists';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_curator_deals_close ON public.curator_deals;
CREATE TRIGGER trg_curator_deals_close
BEFORE UPDATE OF closed_at, closed_status ON public.curator_deals
FOR EACH ROW EXECUTE FUNCTION public.trg_curator_deals_close_state();

-- 6) Derivação de metas: soma das músicas → curator_deals
CREATE OR REPLACE FUNCTION public.recompute_curator_deal_totals(p_deal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.curator_deals d
     SET target_plays = COALESCE(t.tot, d.target_plays),
         daily_goal   = COALESCE(t.dg, d.daily_goal)
    FROM (
      SELECT deal_id,
             SUM(COALESCE(target_plays,0))::bigint AS tot,
             SUM(COALESCE(daily_goal,0))::bigint   AS dg
        FROM public.curator_deal_songs
       WHERE deal_id = p_deal_id
       GROUP BY deal_id
    ) t
   WHERE d.id = p_deal_id AND t.deal_id = d.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_recompute_deal_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_curator_deal_totals(COALESCE(NEW.deal_id, OLD.deal_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_curator_deal_songs_totals ON public.curator_deal_songs;
CREATE TRIGGER trg_curator_deal_songs_totals
AFTER INSERT OR UPDATE OF target_plays, daily_goal OR DELETE ON public.curator_deal_songs
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_deal_totals();

-- 7) Detecção de deals duplicados (mesmo curator + mesma música + janela ativa sobreposta)
CREATE OR REPLACE FUNCTION public.detect_duplicate_curator_deal(
  p_user_id uuid,
  p_curator_id uuid,
  p_curator_name text,
  p_spotify_track_id text,
  p_song_spotify_url text,
  p_started_at timestamptz,
  p_ends_at timestamptz
) RETURNS TABLE(deal_id uuid, song_name text, started_at timestamptz, ends_at timestamptz, state text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id, d.song_name, d.started_at, d.ends_at, d.state
    FROM public.curator_deals d
   WHERE d.user_id = p_user_id
     AND d.closed_at IS NULL
     AND (
       (p_curator_id IS NOT NULL AND d.curator_id = p_curator_id)
       OR (p_curator_id IS NULL AND lower(trim(d.curator_name)) = lower(trim(p_curator_name)))
     )
     AND (
       (p_spotify_track_id IS NOT NULL
         AND public.extract_spotify_playlist_id(d.song_spotify_url) IS NOT DISTINCT FROM p_spotify_track_id)
       OR d.song_spotify_url = p_song_spotify_url
       OR EXISTS (
         SELECT 1 FROM public.curator_deal_songs s
          WHERE s.deal_id = d.id
            AND (
              s.spotify_track_id = p_spotify_track_id
              OR s.song_spotify_url = p_song_spotify_url
            )
       )
     )
     AND COALESCE(d.started_at, now()) <= COALESCE(p_ends_at, 'infinity'::timestamptz)
     AND COALESCE(d.ends_at, 'infinity'::timestamptz) >= COALESCE(p_started_at, now());
$$;

-- 8) Detecção de playlists duplicadas entre deals ativos
CREATE OR REPLACE FUNCTION public.detect_duplicate_curator_playlists(p_user_id uuid)
RETURNS TABLE(spotify_playlist_id text, song_signature text, deal_ids uuid[], deals_count int)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cp.spotify_playlist_id,
         COALESCE(cds.spotify_track_id, cds.song_spotify_url) AS song_signature,
         array_agg(DISTINCT cp.deal_id) AS deal_ids,
         count(DISTINCT cp.deal_id)::int AS deals_count
    FROM public.curator_playlists cp
    JOIN public.curator_deals d ON d.id = cp.deal_id
    LEFT JOIN public.curator_deal_songs cds ON cds.id = cp.song_id
   WHERE d.user_id = p_user_id
     AND d.closed_at IS NULL
     AND cp.match_status = 'curator'
     AND cp.spotify_playlist_id IS NOT NULL
   GROUP BY cp.spotify_playlist_id, COALESCE(cds.spotify_track_id, cds.song_spotify_url)
  HAVING count(DISTINCT cp.deal_id) > 1;
$$;

-- 9) RPC transacional para criar deal + songs atomicamente
CREATE OR REPLACE FUNCTION public.create_curator_deal_atomic(
  p_deal jsonb,
  p_songs jsonb,
  p_force boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_deal_id uuid;
  v_dup jsonb;
  v_song jsonb;
  v_song_id uuid;
  v_first_song_target bigint := 0;
  v_first_song_daily bigint := 0;
  v_first_song_url text;
  v_first_song_name text;
  v_first_song_artist text;
  v_first_song_cover text;
  v_first_track_id text;
  v_started_at timestamptz;
  v_ends_at timestamptz;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF p_songs IS NULL OR jsonb_typeof(p_songs) <> 'array' OR jsonb_array_length(p_songs) = 0 THEN
    RAISE EXCEPTION 'É necessário ao menos uma música' USING ERRCODE = '23514';
  END IF;

  v_song := p_songs->0;
  v_first_song_url   := v_song->>'song_spotify_url';
  v_first_song_name  := v_song->>'song_name';
  v_first_song_artist:= v_song->>'song_artist';
  v_first_song_cover := v_song->>'song_cover_url';
  v_first_track_id   := v_song->>'spotify_track_id';
  v_first_song_target:= COALESCE((v_song->>'target_plays')::bigint, 0);
  v_first_song_daily := COALESCE((v_song->>'daily_goal')::bigint, 0);
  v_started_at := COALESCE(NULLIF(p_deal->>'started_at','')::timestamptz, now());
  v_ends_at    := NULLIF(p_deal->>'ends_at','')::timestamptz;

  -- Detecta duplicidade
  SELECT to_jsonb(array_agg(row_to_json(d)))
    INTO v_dup
    FROM public.detect_duplicate_curator_deal(
      v_user_id,
      NULLIF(p_deal->>'curator_id','')::uuid,
      p_deal->>'curator_name',
      v_first_track_id,
      v_first_song_url,
      v_started_at,
      v_ends_at
    ) d;

  IF v_dup IS NOT NULL AND jsonb_array_length(v_dup) > 0 AND NOT p_force THEN
    RETURN jsonb_build_object('ok', false, 'duplicate', true, 'matches', v_dup);
  END IF;

  -- Cria deal (a derivação de totais será feita pelo trigger ao inserir as songs)
  INSERT INTO public.curator_deals (
    user_id, curator_id, curator_name,
    song_spotify_url, song_name, song_artist, song_cover_url,
    target_plays, daily_goal, baseline_plays, cost,
    started_at, ends_at, ramp_up_days
  ) VALUES (
    v_user_id,
    NULLIF(p_deal->>'curator_id','')::uuid,
    p_deal->>'curator_name',
    v_first_song_url, v_first_song_name, v_first_song_artist, v_first_song_cover,
    v_first_song_target,
    v_first_song_daily,
    COALESCE((p_deal->>'baseline_plays')::bigint, 0),
    NULLIF(p_deal->>'cost','')::numeric,
    v_started_at, v_ends_at,
    COALESCE((p_deal->>'ramp_up_days')::int, 5)
  ) RETURNING id INTO v_deal_id;

  -- Insere todas as músicas
  FOR v_song IN SELECT * FROM jsonb_array_elements(p_songs)
  LOOP
    INSERT INTO public.curator_deal_songs (
      deal_id, song_spotify_url, spotify_track_id,
      song_name, song_artist, artist_candidates, song_cover_url,
      daily_goal, duration_days, target_plays, position,
      started_at, ends_at, ramp_up_days,
      auto_collect, auto_collect_status, auto_collect_interval_minutes,
      next_auto_collect_at
    ) VALUES (
      v_deal_id,
      v_song->>'song_spotify_url',
      NULLIF(v_song->>'spotify_track_id',''),
      v_song->>'song_name',
      NULLIF(v_song->>'song_artist',''),
      COALESCE(
        (SELECT array_agg(value::text) FROM jsonb_array_elements_text(v_song->'artist_candidates')),
        ARRAY[]::text[]
      ),
      NULLIF(v_song->>'song_cover_url',''),
      COALESCE((v_song->>'daily_goal')::bigint, 0),
      COALESCE((v_song->>'duration_days')::int, 30),
      NULLIF(v_song->>'target_plays','')::bigint,
      COALESCE((v_song->>'position')::int, 0),
      NULLIF(v_song->>'started_at','')::timestamptz,
      NULLIF(v_song->>'ends_at','')::timestamptz,
      COALESCE((v_song->>'ramp_up_days')::int, 5),
      true, 'idle', 1440, now()
    ) RETURNING id INTO v_song_id;
  END LOOP;

  PERFORM public.recompute_curator_deal_state(v_deal_id);

  RETURN jsonb_build_object('ok', true, 'deal_id', v_deal_id, 'duplicate_warning', v_dup);
END;
$$;

-- 10) Inicializar state nos deals existentes
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.curator_deals LOOP
    PERFORM public.recompute_curator_deal_state(r.id);
  END LOOP;
END $$;