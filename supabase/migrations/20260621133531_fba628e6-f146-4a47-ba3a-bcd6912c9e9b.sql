
CREATE OR REPLACE FUNCTION public.auto_complete_oauth_migration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.app_id IS NOT NULL AND (OLD.app_id IS DISTINCT FROM NEW.app_id) THEN
    UPDATE public.oauth_migration_plan
      SET status = 'done',
          completed_at = now(),
          notes = coalesce(notes,'') || ' | auto-completed on re-OAuth at '|| now()::text
      WHERE token_id = NEW.id
        AND status = 'pending'
        AND target_app_id = NEW.app_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_complete_oauth_migration ON public.spotify_user_tokens;
CREATE TRIGGER trg_auto_complete_oauth_migration
  AFTER UPDATE OF app_id ON public.spotify_user_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_complete_oauth_migration();
