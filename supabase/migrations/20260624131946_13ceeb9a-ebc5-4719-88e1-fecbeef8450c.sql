
ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS catalog_sync_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS catalog_sync_batch_size smallint NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS catalog_sync_priority smallint NOT NULL DEFAULT 3;
