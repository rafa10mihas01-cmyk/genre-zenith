
ALTER TABLE public.external_curators
  ADD COLUMN IF NOT EXISTS pipeline_status text NOT NULL DEFAULT 'novo',
  ADD COLUMN IF NOT EXISTS commercial_score jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS operational_tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS whatsapp text,
  ADD COLUMN IF NOT EXISTS last_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS followup_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.validate_external_curator_pipeline_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.pipeline_status NOT IN ('novo','contatado','respondeu','negociando','fechado','sem_resposta','blacklist') THEN
    RAISE EXCEPTION 'invalid pipeline_status: %', NEW.pipeline_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_external_curators_status ON public.external_curators;
CREATE TRIGGER trg_external_curators_status
  BEFORE INSERT OR UPDATE OF pipeline_status ON public.external_curators
  FOR EACH ROW EXECUTE FUNCTION public.validate_external_curator_pipeline_status();

CREATE INDEX IF NOT EXISTS idx_external_curators_pipeline_status
  ON public.external_curators(pipeline_status);

ALTER TABLE public.curator_outreach_log
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS note text;

CREATE OR REPLACE FUNCTION public.validate_outreach_event_type()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.event_type NOT IN ('sent','opened','replied','followup_1','followup_2','note') THEN
    RAISE EXCEPTION 'invalid event_type: %', NEW.event_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outreach_event_type ON public.curator_outreach_log;
CREATE TRIGGER trg_outreach_event_type
  BEFORE INSERT OR UPDATE OF event_type ON public.curator_outreach_log
  FOR EACH ROW EXECUTE FUNCTION public.validate_outreach_event_type();

CREATE INDEX IF NOT EXISTS idx_curator_outreach_log_curator_sent
  ON public.curator_outreach_log(external_curator_id, sent_at DESC);

CREATE OR REPLACE FUNCTION public.sync_curator_on_reply()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.event_type = 'replied' AND NEW.external_curator_id IS NOT NULL THEN
    UPDATE public.external_curators
       SET last_response_at = COALESCE(NEW.sent_at, now()),
           pipeline_status = CASE
             WHEN pipeline_status IN ('blacklist','fechado','negociando') THEN pipeline_status
             ELSE 'respondeu'
           END
     WHERE id = NEW.external_curator_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outreach_sync_reply ON public.curator_outreach_log;
CREATE TRIGGER trg_outreach_sync_reply
  AFTER INSERT ON public.curator_outreach_log
  FOR EACH ROW EXECUTE FUNCTION public.sync_curator_on_reply();
