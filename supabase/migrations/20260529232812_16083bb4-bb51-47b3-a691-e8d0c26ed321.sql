-- Trigger: fecha automaticamente a campanha quando bate a meta.
CREATE OR REPLACE FUNCTION public.auto_complete_campaign_on_goal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Só age em campanhas vivas que bateram a meta.
  IF NEW.goal_plays IS NOT NULL
     AND NEW.goal_plays > 0
     AND COALESCE(NEW.total_delivered, 0) >= NEW.goal_plays
     AND NEW.status IN ('active', 'paused')
  THEN
    NEW.status := 'completed';
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_complete_campaign_on_goal ON public.campaigns;
CREATE TRIGGER trg_auto_complete_campaign_on_goal
BEFORE INSERT OR UPDATE OF total_delivered, goal_plays, status ON public.campaigns
FOR EACH ROW
EXECUTE FUNCTION public.auto_complete_campaign_on_goal();