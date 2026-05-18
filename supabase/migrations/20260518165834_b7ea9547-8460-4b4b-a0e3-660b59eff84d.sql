ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_type text NOT NULL DEFAULT 'artist'
    CHECK (client_type IN ('artist','label','manager','producer','other')),
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS instagram text,
  ADD COLUMN IF NOT EXISTS spotify_artist_url text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS primary_genre text,
  ADD COLUMN IF NOT EXISTS monthly_listeners integer CHECK (monthly_listeners IS NULL OR monthly_listeners >= 0),
  ADD COLUMN IF NOT EXISTS document text,
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.clients.client_type IS 'Tipo de cliente: artist | label | manager | producer | other';
COMMENT ON COLUMN public.clients.contact IS 'Campo legado de contato livre — preferir phone/email/instagram.';