-- Token público do Mapa de Entrega — separado do token privado do portal
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS roadmap_token text;

-- Preenche tokens para linhas existentes (18 bytes = 36 chars hex, 144 bits de entropia)
UPDATE public.campaigns
SET roadmap_token = encode(gen_random_bytes(18), 'hex')
WHERE roadmap_token IS NULL;

-- Default e NOT NULL depois do backfill
ALTER TABLE public.campaigns
  ALTER COLUMN roadmap_token SET DEFAULT encode(gen_random_bytes(18), 'hex');

ALTER TABLE public.campaigns
  ALTER COLUMN roadmap_token SET NOT NULL;

-- Unicidade + lookup rápido
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_roadmap_token_key
  ON public.campaigns(roadmap_token);

-- NÃO há GRANT para anon. O acesso é mediado pela edge function get-campaign-roadmap-public
-- (service-role + whitelist de campos). RLS atual da tabela permanece intacta.