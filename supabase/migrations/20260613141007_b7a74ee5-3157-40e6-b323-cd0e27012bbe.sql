CREATE OR REPLACE FUNCTION public.supersede_previous_bot_print_batches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
     AND (old.created_at AT TIME ZONE 'America/Sao_Paulo')::date = new_local_day
     AND old.created_at <= NEW.created_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supersede_previous_bot_print_batches ON public.bot_print_batches;
CREATE TRIGGER trg_supersede_previous_bot_print_batches
AFTER INSERT OR UPDATE OF status, print_urls, completed_at, processed_at ON public.bot_print_batches
FOR EACH ROW
EXECUTE FUNCTION public.supersede_previous_bot_print_batches();

WITH valid_batches AS (
  SELECT
    b.id,
    row_number() OVER (
      PARTITION BY b.deal_id, b.song_id, (b.created_at AT TIME ZONE 'America/Sao_Paulo')::date
      ORDER BY b.created_at DESC, b.id DESC
    ) AS rn,
    first_value(b.id) OVER (
      PARTITION BY b.deal_id, b.song_id, (b.created_at AT TIME ZONE 'America/Sao_Paulo')::date
      ORDER BY b.created_at DESC, b.id DESC
    ) AS keeper_id
  FROM public.bot_print_batches b
  JOIN public.campaigns c ON c.deal_id = b.deal_id
  WHERE c.baseline_status = 'captured'
    AND b.status IN ('complete', 'processed', 'error')
    AND jsonb_typeof(b.print_urls) = 'array'
    AND jsonb_array_length(b.print_urls) > 0
)
UPDATE public.bot_print_batches b
   SET superseded_by = CASE WHEN v.rn = 1 THEN NULL ELSE v.keeper_id END,
       updated_at = now()
  FROM valid_batches v
 WHERE b.id = v.id
   AND b.superseded_by IS DISTINCT FROM CASE WHEN v.rn = 1 THEN NULL ELSE v.keeper_id END;