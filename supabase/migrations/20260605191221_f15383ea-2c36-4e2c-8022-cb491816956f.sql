
-- =====================================================================
-- Correção definitiva Carnívoro: trigger preventivo + função de backfill
-- =====================================================================

-- 1) Função idempotente de backfill: cria curator_deal_songs derivado da
--    linha-pai de curator_deals quando ela existe mas a song ainda não foi
--    materializada. Pode receber lista de deal_ids ou rodar em todos os
--    deals ativos elegíveis (source NULL, song_spotify_url presente, sem
--    closed_at, sem song existente).
CREATE OR REPLACE FUNCTION public.backfill_curator_deal_songs(
  p_deal_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(deal_id uuid, song_id uuid, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_song_id uuid;
  v_track_id text;
BEGIN
  FOR r IN
    SELECT cd.*
    FROM curator_deals cd
    WHERE cd.closed_at IS NULL
      AND cd.source IS NULL
      AND cd.song_spotify_url IS NOT NULL
      AND (p_deal_ids IS NULL OR cd.id = ANY(p_deal_ids))
      AND NOT EXISTS (
        SELECT 1 FROM curator_deal_songs s WHERE s.deal_id = cd.id
      )
  LOOP
    v_track_id := NULLIF(substring(r.song_spotify_url FROM 'track/([A-Za-z0-9]+)'), '');

    INSERT INTO curator_deal_songs (
      deal_id, song_spotify_url, spotify_track_id,
      song_name, song_artist, song_cover_url,
      daily_goal, target_plays, baseline_plays,
      position, started_at, ends_at,
      auto_collect, auto_collect_status,
      auto_collect_interval_minutes, next_auto_collect_at
    ) VALUES (
      r.id, r.song_spotify_url, v_track_id,
      r.song_name, r.song_artist, r.song_cover_url,
      COALESCE(r.daily_goal, 0), r.target_plays, COALESCE(r.baseline_plays, 0),
      1, r.started_at, r.ends_at,
      true, 'idle',
      60, now()
    )
    RETURNING id INTO v_song_id;

    deal_id := r.id;
    song_id := v_song_id;
    action  := 'created';
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_curator_deal_songs(uuid[]) TO service_role;

-- 2) Trigger preventivo: sempre que um novo curator_deal nasce pelo fluxo
--    legado (source NULL + song_spotify_url presente), materializa a song
--    correspondente em curator_deal_songs com auto_collect ligado.
--    Shadow deals (source = 'campaign_internal') NÃO entram aqui.
CREATE OR REPLACE FUNCTION public.tg_curator_deal_autocreate_song()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_track_id text;
BEGIN
  IF NEW.source IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.song_spotify_url IS NULL OR NEW.song_spotify_url = '' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM curator_deal_songs s WHERE s.deal_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_track_id := NULLIF(substring(NEW.song_spotify_url FROM 'track/([A-Za-z0-9]+)'), '');

  INSERT INTO curator_deal_songs (
    deal_id, song_spotify_url, spotify_track_id,
    song_name, song_artist, song_cover_url,
    daily_goal, target_plays, baseline_plays,
    position, started_at, ends_at,
    auto_collect, auto_collect_status,
    auto_collect_interval_minutes, next_auto_collect_at
  ) VALUES (
    NEW.id, NEW.song_spotify_url, v_track_id,
    NEW.song_name, NEW.song_artist, NEW.song_cover_url,
    COALESCE(NEW.daily_goal, 0), NEW.target_plays, COALESCE(NEW.baseline_plays, 0),
    1, NEW.started_at, NEW.ends_at,
    true, 'idle',
    60, now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_curator_deal_autocreate_song ON public.curator_deals;
CREATE TRIGGER tg_curator_deal_autocreate_song
AFTER INSERT ON public.curator_deals
FOR EACH ROW
EXECUTE FUNCTION public.tg_curator_deal_autocreate_song();
