
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS campaign_type text NOT NULL DEFAULT 'hybrid'
    CHECK (campaign_type IN ('ecosystem','external','hybrid')),
  ADD COLUMN IF NOT EXISTS plan_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS auto_deal_created boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_campaigns_type ON public.campaigns(campaign_type);
CREATE INDEX IF NOT EXISTS idx_campaigns_plan_approval ON public.campaigns(plan_approved_at) WHERE plan_approved_at IS NULL;

ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS auto_deal_from_campaign boolean NOT NULL DEFAULT false;
