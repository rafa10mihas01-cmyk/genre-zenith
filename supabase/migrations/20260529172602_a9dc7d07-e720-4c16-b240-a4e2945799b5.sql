ALTER TABLE public.clients 
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS brand_color TEXT;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_brand_color_hex_chk
  CHECK (brand_color IS NULL OR brand_color ~* '^#[0-9a-f]{6}$');