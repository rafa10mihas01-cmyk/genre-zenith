ALTER TABLE public.curator_deals
ADD COLUMN IF NOT EXISTS daily_goal bigint NOT NULL DEFAULT 0;