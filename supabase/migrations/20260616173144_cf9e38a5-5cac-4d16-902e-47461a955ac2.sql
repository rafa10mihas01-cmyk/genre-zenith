CREATE OR REPLACE FUNCTION public.supersede_previous_bot_print_batches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_local_day date;
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

  new_local_day := (NEW.created_at AT TIME ZONE 'America/Sao_Paulo')::date;

  UPDATE public.bot_print_batches AS prev
     SET superseded_by = NEW.id,
         updated_at = now()
   WHERE prev.id <> NEW.id
     AND prev.deal_id = NEW.deal_id
     AND prev.song_id IS NOT DISTINCT FROM NEW.song_id
     AND prev.superseded_by IS NULL
     AND prev.status IN ('complete', 'processed', 'error')
     AND jsonb_typeof(prev.print_urls) = 'array'
     AND jsonb_array_length(prev.print_urls) > 0
     AND (prev.created_at AT TIME ZONE 'America/Sao_Paulo')::date = new_local_day
     AND prev.created_at <= NEW.created_at;

  RETURN NEW;
END;
$function$;