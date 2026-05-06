ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS client_token text
  DEFAULT encode(extensions.gen_random_bytes(12), 'hex');

UPDATE public.curator_deals
  SET client_token = encode(extensions.gen_random_bytes(12), 'hex')
  WHERE client_token IS NULL;

ALTER TABLE public.curator_deals
  ALTER COLUMN client_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS curator_deals_client_token_key
  ON public.curator_deals(client_token);