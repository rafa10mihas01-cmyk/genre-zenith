
-- 1) Auto-sync trigger: quando uma nova música é inserida num deal vinculado a campanha com baseline capturada, espelha automaticamente.
CREATE OR REPLACE FUNCTION public._trg_sync_baseline_on_song_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deal_id IS NOT NULL THEN
    PERFORM public.sync_deal_campaign_baseline(NEW.deal_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_baseline_on_song_insert ON public.curator_deal_songs;
CREATE TRIGGER trg_sync_baseline_on_song_insert
AFTER INSERT ON public.curator_deal_songs
FOR EACH ROW EXECUTE FUNCTION public._trg_sync_baseline_on_song_insert();

-- 2) Auto-sync trigger: quando um deal é criado em campanha com baseline capturada, espelha.
CREATE OR REPLACE FUNCTION public._trg_sync_baseline_on_deal_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.campaign_id IS NOT NULL THEN
    PERFORM public.sync_deal_campaign_baseline(NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_baseline_on_deal_insert ON public.curator_deals;
CREATE TRIGGER trg_sync_baseline_on_deal_insert
AFTER INSERT ON public.curator_deals
FOR EACH ROW EXECUTE FUNCTION public._trg_sync_baseline_on_deal_insert();

-- 3) Auto-sync trigger: quando uma campanha vira baseline=captured, espelha pra todos os deals já existentes.
CREATE OR REPLACE FUNCTION public._trg_sync_baseline_on_campaign_captured()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.baseline_status = 'captured'
     AND (OLD.baseline_status IS DISTINCT FROM 'captured'
          OR OLD.baseline_captured_at IS DISTINCT FROM NEW.baseline_captured_at) THEN
    PERFORM public.sync_campaign_deals_baseline(NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_baseline_on_campaign_captured ON public.campaigns;
CREATE TRIGGER trg_sync_baseline_on_campaign_captured
AFTER UPDATE OF baseline_status, baseline_captured_at ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION public._trg_sync_baseline_on_campaign_captured();

-- 4) Backfill: roda o sync em todas as campanhas com baseline capturado (idempotente via ON CONFLICT DO UPDATE).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.campaigns WHERE baseline_status = 'captured' LOOP
    PERFORM public.sync_campaign_deals_baseline(r.id);
  END LOOP;
END;
$$;
