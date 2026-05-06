ALTER TABLE public.curator_deal_snapshots
  ADD COLUMN IF NOT EXISTS plays_24h bigint,
  ADD COLUMN IF NOT EXISTS plays_7d  bigint,
  ADD COLUMN IF NOT EXISTS plays_28d bigint;

ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS payout_window text NOT NULL DEFAULT '24h'
    CHECK (payout_window IN ('24h','7d','28d'));

CREATE INDEX IF NOT EXISTS idx_curator_deal_snapshots_deal_captured
  ON public.curator_deal_snapshots (deal_id, captured_at DESC);