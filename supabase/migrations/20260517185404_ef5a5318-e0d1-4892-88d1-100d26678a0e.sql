
DO $$ BEGIN
  CREATE TYPE public.curatorial_state AS ENUM (
    'saudavel','observacao','leve','moderada','estrutural','cooldown'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.curatorial_action_type AS ENUM (
    'cover','description','tracks_light','tracks_recycle','structural'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.managed_playlists
  ADD COLUMN IF NOT EXISTS curatorial_state public.curatorial_state NOT NULL DEFAULT 'saudavel',
  ADD COLUMN IF NOT EXISTS max_change_pct numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS recommended_change_count integer,
  ADD COLUMN IF NOT EXISTS last_maintenance_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_maintenance_intensity public.curatorial_action_type;

CREATE INDEX IF NOT EXISTS idx_managed_playlists_curatorial_state
  ON public.managed_playlists(curatorial_state);

CREATE TABLE IF NOT EXISTS public.playlist_cooldowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  action_type public.curatorial_action_type NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  cooldown_until timestamptz NOT NULL,
  reason text,
  triggered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playlist_cooldowns_playlist
  ON public.playlist_cooldowns(playlist_id, action_type, cooldown_until DESC);

ALTER TABLE public.playlist_cooldowns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_select_playlist_cooldowns" ON public.playlist_cooldowns;
CREATE POLICY "team_select_playlist_cooldowns" ON public.playlist_cooldowns
  FOR SELECT TO authenticated USING (has_team_access());
DROP POLICY IF EXISTS "team_insert_playlist_cooldowns" ON public.playlist_cooldowns;
CREATE POLICY "team_insert_playlist_cooldowns" ON public.playlist_cooldowns
  FOR INSERT TO authenticated WITH CHECK (has_team_access());
DROP POLICY IF EXISTS "team_update_playlist_cooldowns" ON public.playlist_cooldowns;
CREATE POLICY "team_update_playlist_cooldowns" ON public.playlist_cooldowns
  FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
DROP POLICY IF EXISTS "team_delete_playlist_cooldowns" ON public.playlist_cooldowns;
CREATE POLICY "team_delete_playlist_cooldowns" ON public.playlist_cooldowns
  FOR DELETE TO authenticated USING (has_team_access());

CREATE OR REPLACE FUNCTION public.default_cooldown_days(_action public.curatorial_action_type)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _action
    WHEN 'cover' THEN 7
    WHEN 'description' THEN 5
    WHEN 'tracks_light' THEN 3
    WHEN 'tracks_recycle' THEN 10
    WHEN 'structural' THEN 14
  END;
$$;

CREATE OR REPLACE FUNCTION public.apply_playlist_cooldown(
  _playlist_id uuid,
  _action public.curatorial_action_type,
  _reason text DEFAULT NULL,
  _days integer DEFAULT NULL,
  _triggered_by uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_days integer; v_id uuid;
BEGIN
  v_days := COALESCE(_days, public.default_cooldown_days(_action));
  INSERT INTO public.playlist_cooldowns (playlist_id, action_type, started_at, cooldown_until, reason, triggered_by)
  VALUES (_playlist_id, _action, now(), now() + (v_days || ' days')::interval, _reason, _triggered_by)
  RETURNING id INTO v_id;

  UPDATE public.managed_playlists
    SET last_maintenance_at = now(),
        last_maintenance_intensity = _action,
        updated_at = now()
    WHERE id = _playlist_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.is_playlist_action_blocked(
  _playlist_id uuid, _action public.curatorial_action_type
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.playlist_cooldowns
    WHERE playlist_id = _playlist_id AND action_type = _action AND cooldown_until > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.get_active_cooldowns(_playlist_id uuid)
RETURNS TABLE (
  action_type public.curatorial_action_type,
  cooldown_until timestamptz,
  days_remaining numeric,
  reason text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (action_type)
    action_type,
    cooldown_until,
    EXTRACT(EPOCH FROM (cooldown_until - now())) / 86400.0,
    reason
  FROM public.playlist_cooldowns
  WHERE playlist_id = _playlist_id AND cooldown_until > now()
  ORDER BY action_type, cooldown_until DESC;
$$;

CREATE OR REPLACE FUNCTION public.map_adjustment_to_curatorial(_action_type text)
RETURNS public.curatorial_action_type LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _action_type ILIKE '%cover%' OR _action_type ILIKE '%capa%' THEN 'cover'::public.curatorial_action_type
    WHEN _action_type ILIKE '%description%' OR _action_type ILIKE '%descri%' THEN 'description'::public.curatorial_action_type
    WHEN _action_type ILIKE '%reorder%' OR _action_type ILIKE '%reorganiz%' OR _action_type ILIKE '%light%' THEN 'tracks_light'::public.curatorial_action_type
    WHEN _action_type ILIKE '%structural%' OR _action_type ILIKE '%estrutural%' THEN 'structural'::public.curatorial_action_type
    WHEN _action_type ILIKE '%track%' OR _action_type ILIKE '%recycle%' OR _action_type ILIKE '%recicl%' THEN 'tracks_recycle'::public.curatorial_action_type
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.trg_auto_apply_cooldown()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid; v_action public.curatorial_action_type;
BEGIN
  IF NEW.status IS DISTINCT FROM 'success' THEN RETURN NEW; END IF;
  v_action := public.map_adjustment_to_curatorial(NEW.action_type);
  IF v_action IS NULL THEN RETURN NEW; END IF;

  IF NEW.spotify_playlist_id IS NOT NULL THEN
    SELECT id INTO v_pid FROM public.managed_playlists
    WHERE spotify_playlist_id = NEW.spotify_playlist_id LIMIT 1;
  END IF;
  IF v_pid IS NULL THEN RETURN NEW; END IF;

  PERFORM public.apply_playlist_cooldown(v_pid, v_action, 'Auto: ' || NEW.action_type, NULL, NULL);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_playlist_adjustments_cooldown ON public.playlist_adjustments;
CREATE TRIGGER trg_playlist_adjustments_cooldown
  AFTER INSERT ON public.playlist_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.trg_auto_apply_cooldown();
