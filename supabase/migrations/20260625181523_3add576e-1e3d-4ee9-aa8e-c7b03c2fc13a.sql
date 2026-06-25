
-- 1) Tabela de acesso S4A: marca quais perfis de artista cada conta S4A do pool consegue ver.
CREATE TABLE IF NOT EXISTS public.spotify_account_artist_access (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.spotify_accounts(account_id) ON DELETE CASCADE,
  spotify_artist_id TEXT NOT NULL,
  has_access BOOLEAN NOT NULL,
  last_probed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  source TEXT NOT NULL DEFAULT 'manual', -- manual | vps_probe | backfill_inferred
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, spotify_artist_id)
);

GRANT SELECT ON public.spotify_account_artist_access TO authenticated;
GRANT ALL    ON public.spotify_account_artist_access TO service_role;

ALTER TABLE public.spotify_account_artist_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage S4A access"
  ON public.spotify_account_artist_access
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_s4a_access_artist
  ON public.spotify_account_artist_access (spotify_artist_id, has_access);

CREATE TRIGGER trg_s4a_access_updated_at
  BEFORE UPDATE ON public.spotify_account_artist_access
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Backfill: qualquer (active_account x spotify_artist_id) que JÁ produziu snapshot
--    é prova de acesso. Sem registro = "desconhecido" (otimismo no dispatch).
INSERT INTO public.spotify_account_artist_access (account_id, spotify_artist_id, has_access, source, notes)
SELECT DISTINCT
  sa.account_id,
  ct.spotify_artist_id,
  true,
  'backfill_inferred',
  'derivado de catalog_track_snapshots existentes'
FROM public.catalog_track_snapshots s
JOIN public.catalog_tracks ct ON ct.id = s.catalog_track_id
JOIN public.spotify_accounts sa ON sa.status = 'active'
WHERE ct.spotify_artist_id IS NOT NULL
ON CONFLICT (account_id, spotify_artist_id) DO NOTHING;

-- 3) Marcar Mc Lobinho como inacessível para Baile Hits Oficial (causa do caso "Tem Buraco Eu To Metendo").
INSERT INTO public.spotify_account_artist_access
  (account_id, spotify_artist_id, has_access, source, last_error, notes)
SELECT
  sa.account_id,
  '5C2UnkLANi0rqvIHDozmSf',
  false,
  'manual',
  'S4A page never loads — artist not a collaborator of this account',
  'Mc Lobinho — derivado de 5 lease_expired consecutivos em 25/06/2026'
FROM public.spotify_accounts sa
WHERE sa.email = 'rafa10mihas01@gmail.com'
ON CONFLICT (account_id, spotify_artist_id) DO UPDATE
SET has_access = EXCLUDED.has_access,
    last_error = EXCLUDED.last_error,
    notes      = EXCLUDED.notes,
    source     = 'manual';
