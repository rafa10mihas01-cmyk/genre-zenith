ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS execution_frozen boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS execution_frozen_at timestamptz,
  ADD COLUMN IF NOT EXISTS execution_frozen_by text,
  ADD COLUMN IF NOT EXISTS execution_frozen_reason text;

UPDATE public.system_flags
SET execution_frozen = true,
    execution_frozen_at = now(),
    execution_frozen_by = 'operator',
    execution_frozen_reason = 'EXECUTION_FREEZE_MODE ativado manualmente pelo operador.'
WHERE singleton_key = 'app';