ALTER TABLE public.bot_print_batches
  ADD COLUMN IF NOT EXISTS dom_payload jsonb NOT NULL DEFAULT '[]'::jsonb;