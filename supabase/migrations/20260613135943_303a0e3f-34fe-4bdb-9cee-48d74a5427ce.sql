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

  UPDATE public.bot_print_batches AS prev_batch
     SET superseded_by = NEW.id,
         updated_at = now()
   WHERE prev_batch.id <> NEW.id
     AND prev_batch.deal_id = NEW.deal_id
     AND prev_batch.song_id IS NOT DISTINCT FROM NEW.song_id
     AND prev_batch.superseded_by IS NULL
     AND prev_batch.status IN ('complete', 'processed', 'error')
     AND jsonb_typeof(prev_batch.print_urls) = 'array'
     AND jsonb_array_length(prev_batch.print_urls) > 0
     AND prev_batch.created_at <= NEW.created_at;

  RETURN NEW;
END;
$$;