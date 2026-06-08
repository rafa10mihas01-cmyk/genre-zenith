ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS ai_editorial_tier text NOT NULL DEFAULT 'top';

ALTER TABLE public.system_flags
  DROP CONSTRAINT IF EXISTS system_flags_ai_editorial_tier_check;

ALTER TABLE public.system_flags
  ADD CONSTRAINT system_flags_ai_editorial_tier_check
  CHECK (ai_editorial_tier IN ('off','top','mid','all'));

UPDATE public.system_flags SET ai_editorial_tier = 'top' WHERE singleton_key = 'app';