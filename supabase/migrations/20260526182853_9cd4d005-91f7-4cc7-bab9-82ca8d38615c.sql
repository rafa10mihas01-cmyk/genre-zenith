
-- 1) Coluna expires_at em campaigns
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- 2) Trigger: preenche expires_at = created_at + 48h em rascunhos;
--    limpa quando vira ativa; reseta quando volta pra draft.
CREATE OR REPLACE FUNCTION public.set_campaign_expires_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'draft' THEN
    -- só seta se ainda não tiver (preserva valor manual)
    IF NEW.expires_at IS NULL THEN
      NEW.expires_at := COALESCE(NEW.created_at, now()) + INTERVAL '48 hours';
    END IF;
  ELSIF NEW.status IN ('active', 'expired') THEN
    -- ativa não expira mais; expired já está fixada no momento da expiração
    IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'active' THEN
      NEW.expires_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaigns_set_expires_at ON public.campaigns;
CREATE TRIGGER trg_campaigns_set_expires_at
BEFORE INSERT OR UPDATE OF status ON public.campaigns
FOR EACH ROW
EXECUTE FUNCTION public.set_campaign_expires_at();

-- 3) Backfill nos rascunhos existentes (48h a partir de agora, pra não
--    expirar tudo de uma vez retroativamente).
UPDATE public.campaigns
SET expires_at = now() + INTERVAL '48 hours'
WHERE status = 'draft' AND expires_at IS NULL;

-- 4) Índice pro cron de expiração varrer rápido.
CREATE INDEX IF NOT EXISTS idx_campaigns_status_expires_at
ON public.campaigns (status, expires_at)
WHERE status = 'draft';
