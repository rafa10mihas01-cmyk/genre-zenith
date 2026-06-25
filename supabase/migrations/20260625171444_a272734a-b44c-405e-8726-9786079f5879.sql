
ALTER TABLE public.occupancy_plans DROP CONSTRAINT IF EXISTS occupancy_plans_mode_check;
ALTER TABLE public.occupancy_plans ADD CONSTRAINT occupancy_plans_mode_check
  CHECK (mode IN ('SHADOW','DUAL_WRITE','PRIMARY'));
