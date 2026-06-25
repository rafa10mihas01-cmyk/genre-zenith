
ALTER TABLE public.playlist_editorial_policies
  ADD COLUMN IF NOT EXISTS policy_type text NOT NULL DEFAULT 'CATALOG'
    CHECK (policy_type IN ('CAMPAIGN','CATALOG'));

CREATE INDEX IF NOT EXISTS idx_pep_policy_type
  ON public.playlist_editorial_policies(policy_type);
