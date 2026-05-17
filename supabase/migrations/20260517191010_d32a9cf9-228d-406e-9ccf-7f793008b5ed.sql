
DO $$ BEGIN
  CREATE TYPE public.impact_verdict AS ENUM ('pending','positive','neutral','negative','inconclusive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.playlist_adjustment_impacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id uuid NOT NULL REFERENCES public.playlist_adjustments(id) ON DELETE CASCADE,
  playlist_id uuid REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  spotify_playlist_id text NOT NULL,
  action_type text NOT NULL,
  observation_window_days integer NOT NULL DEFAULT 7,
  observation_ends_at timestamptz NOT NULL,
  snapshot_before jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_after jsonb,
  delta jsonb,
  verdict public.impact_verdict NOT NULL DEFAULT 'pending',
  editorial_note text,
  evaluated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pai_playlist ON public.playlist_adjustment_impacts(playlist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pai_pending ON public.playlist_adjustment_impacts(observation_ends_at) WHERE verdict = 'pending';
CREATE INDEX IF NOT EXISTS idx_pai_adjustment ON public.playlist_adjustment_impacts(adjustment_id);

ALTER TABLE public.playlist_adjustment_impacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_pai" ON public.playlist_adjustment_impacts FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_pai" ON public.playlist_adjustment_impacts FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_pai" ON public.playlist_adjustment_impacts FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_pai" ON public.playlist_adjustment_impacts FOR DELETE TO authenticated USING (has_team_access());

CREATE TRIGGER trg_pai_updated_at BEFORE UPDATE ON public.playlist_adjustment_impacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.trg_open_impact_window()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_playlist_id uuid;
  v_followers bigint;
  v_tracks integer;
  v_window integer;
BEGIN
  IF NEW.status <> 'success' OR NEW.spotify_playlist_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_window := CASE NEW.action_type
    WHEN 'cover' THEN 14
    WHEN 'description' THEN 7
    WHEN 'tracks_structural' THEN 10
    WHEN 'tracks_moderate' THEN 7
    WHEN 'tracks_light' THEN 5
    ELSE 7
  END;

  SELECT id, followers, tracks_count
    INTO v_playlist_id, v_followers, v_tracks
    FROM public.managed_playlists
   WHERE spotify_playlist_id = NEW.spotify_playlist_id
   LIMIT 1;

  INSERT INTO public.playlist_adjustment_impacts (
    adjustment_id, playlist_id, spotify_playlist_id, action_type,
    observation_window_days, observation_ends_at, snapshot_before
  ) VALUES (
    NEW.id, v_playlist_id, NEW.spotify_playlist_id, NEW.action_type,
    v_window, now() + (v_window || ' days')::interval,
    jsonb_build_object(
      'followers', COALESCE(v_followers, 0),
      'tracks_count', COALESCE(v_tracks, 0),
      'captured_at', now()
    )
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_playlist_adjustments_open_impact ON public.playlist_adjustments;
CREATE TRIGGER trg_playlist_adjustments_open_impact
  AFTER INSERT ON public.playlist_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.trg_open_impact_window();

CREATE OR REPLACE FUNCTION public.evaluate_pending_impacts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec record;
  v_after_followers bigint;
  v_after_tracks integer;
  v_before_followers bigint;
  v_delta_followers bigint;
  v_delta_pct numeric;
  v_verdict public.impact_verdict;
  v_note text;
  v_count integer := 0;
BEGIN
  FOR rec IN
    SELECT pai.*, mp.followers AS current_followers, mp.tracks_count AS current_tracks
      FROM public.playlist_adjustment_impacts pai
      LEFT JOIN public.managed_playlists mp ON mp.id = pai.playlist_id
     WHERE pai.verdict = 'pending'
       AND pai.observation_ends_at <= now()
     LIMIT 200
  LOOP
    v_before_followers := COALESCE((rec.snapshot_before->>'followers')::bigint, 0);
    v_after_followers := COALESCE(rec.current_followers, v_before_followers);
    v_after_tracks := COALESCE(rec.current_tracks, 0);
    v_delta_followers := v_after_followers - v_before_followers;
    v_delta_pct := CASE WHEN v_before_followers > 0
      THEN ROUND((v_delta_followers::numeric / v_before_followers::numeric) * 100, 2)
      ELSE 0 END;

    v_verdict := CASE
      WHEN v_before_followers = 0 THEN 'inconclusive'
      WHEN v_delta_pct >= 2 THEN 'positive'
      WHEN v_delta_pct <= -2 THEN 'negative'
      ELSE 'neutral'
    END;

    v_note := CASE v_verdict
      WHEN 'positive' THEN format('Crescimento de %s seguidores (+%s%%) em %s dias após %s.', v_delta_followers, v_delta_pct, rec.observation_window_days, rec.action_type)
      WHEN 'negative' THEN format('Queda de %s seguidores (%s%%) em %s dias após %s.', v_delta_followers, v_delta_pct, rec.observation_window_days, rec.action_type)
      WHEN 'neutral'  THEN format('Variação irrelevante (%s%%) em %s dias após %s.', v_delta_pct, rec.observation_window_days, rec.action_type)
      ELSE 'Sem baseline suficiente para conclusão.'
    END;

    UPDATE public.playlist_adjustment_impacts
       SET snapshot_after = jsonb_build_object(
             'followers', v_after_followers,
             'tracks_count', v_after_tracks,
             'captured_at', now()
           ),
           delta = jsonb_build_object(
             'followers', v_delta_followers,
             'followers_pct', v_delta_pct
           ),
           verdict = v_verdict,
           editorial_note = v_note,
           evaluated_at = now()
     WHERE id = rec.id;

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
