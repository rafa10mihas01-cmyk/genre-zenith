ALTER TABLE public.plan_execution_snapshots
  ADD COLUMN accuracy_grade TEXT;

CREATE INDEX plan_exec_snap_grade_idx
  ON public.plan_execution_snapshots (accuracy_grade)
  WHERE accuracy_grade IS NOT NULL;