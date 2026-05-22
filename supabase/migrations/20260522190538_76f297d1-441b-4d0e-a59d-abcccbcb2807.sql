
-- 1. Fix delivery_proofs: restrict INSERT to service_role only
DROP POLICY IF EXISTS service_insert_proofs ON public.delivery_proofs;
CREATE POLICY service_insert_proofs ON public.delivery_proofs
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role');

-- 2. Fix deal-prints storage: require has_team_access() for authenticated uploads
DROP POLICY IF EXISTS "deal-prints authenticated upload" ON storage.objects;
CREATE POLICY "deal-prints team upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deal-prints' AND public.has_team_access());

-- 3. Fix v_financial_summary: set security_invoker so it respects caller's RLS
ALTER VIEW public.v_financial_summary SET (security_invoker = true);
