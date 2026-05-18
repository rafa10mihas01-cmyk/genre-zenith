ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS public_plan_token text;

UPDATE public.campaigns
  SET public_plan_token = replace(gen_random_uuid()::text, '-', '')
  WHERE public_plan_token IS NULL;

ALTER TABLE public.campaigns
  ALTER COLUMN public_plan_token SET DEFAULT replace(gen_random_uuid()::text, '-', '');

ALTER TABLE public.campaigns
  ALTER COLUMN public_plan_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_public_plan_token_key
  ON public.campaigns (public_plan_token);