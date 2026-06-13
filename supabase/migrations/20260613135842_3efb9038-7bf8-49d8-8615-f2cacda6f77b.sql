CREATE OR REPLACE FUNCTION public.supersede_previous_bot_print_batches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.superseded_by IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('complete', 'processed', 'error') THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.print_urls) <> 'array' OR jsonb_array_length(NEW.print_urls) = 0 THEN
    RETURN NEW;
  END IF;

  UPDATE public.bot_print_batches old
     SET superseded_by = NEW.id,
         updated_at = now()
   WHERE old.id <> NEW.id
     AND old.deal_id = NEW.deal_id
     AND old.song_id IS NOT DISTINCT FROM NEW.song_id
     AND old.superseded_by IS NULL
     AND old.status IN ('complete', 'processed', 'error')
     AND jsonb_typeof(old.print_urls) = 'array'
     AND jsonb_array_length(old.print_urls) > 0
     AND old.created_at <= NEW.created_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supersede_previous_bot_print_batches ON public.bot_print_batches;
CREATE TRIGGER trg_supersede_previous_bot_print_batches
AFTER INSERT OR UPDATE OF status, print_urls, completed_at, processed_at ON public.bot_print_batches
FOR EACH ROW
EXECUTE FUNCTION public.supersede_previous_bot_print_batches();