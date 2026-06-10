CREATE OR REPLACE FUNCTION public.compute_song_target_plays()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.daily_goal > 0 AND NEW.duration_days > 0 THEN
    IF TG_OP = 'INSERT' THEN
      IF COALESCE(NEW.target_plays, 0) = 0 THEN
        NEW.target_plays := NEW.daily_goal * NEW.duration_days;
      END IF;
    ELSIF NEW.target_plays IS NOT DISTINCT FROM OLD.target_plays THEN
      NEW.target_plays := NEW.daily_goal * NEW.duration_days;
    END IF;
  END IF;

  IF NEW.started_at IS NOT NULL AND NEW.duration_days > 0 AND NEW.ends_at IS NULL THEN
    NEW.ends_at := NEW.started_at + (NEW.duration_days || ' days')::interval;
  END IF;

  RETURN NEW;
END;
$$;