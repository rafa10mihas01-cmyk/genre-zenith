
ALTER TABLE public.curator_deal_snapshots
  ADD COLUMN IF NOT EXISTS flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reason text;

CREATE INDEX IF NOT EXISTS idx_curator_deal_snapshots_flagged
  ON public.curator_deal_snapshots(deal_id) WHERE flagged = true;
