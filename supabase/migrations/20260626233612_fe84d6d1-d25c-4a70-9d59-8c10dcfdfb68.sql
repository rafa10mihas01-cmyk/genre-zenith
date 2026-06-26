ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS catalog_executor_per_minute_limit integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS occupancy_executor_per_minute_limit integer NOT NULL DEFAULT 5;