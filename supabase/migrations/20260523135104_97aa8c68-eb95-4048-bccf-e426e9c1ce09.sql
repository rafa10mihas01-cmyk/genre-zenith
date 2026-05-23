-- 1) Reforça RLS de community_members: split em duas policies, uma só pra campos seguros
DROP POLICY IF EXISTS "member_update_own_safe_fields" ON public.community_members;

CREATE POLICY "member_update_own_safe_fields"
ON public.community_members
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND points IS NOT DISTINCT FROM (SELECT points FROM public.community_members m WHERE m.id = community_members.id)
  AND tier IS NOT DISTINCT FROM (SELECT tier FROM public.community_members m WHERE m.id = community_members.id)
  AND status IS NOT DISTINCT FROM (SELECT status FROM public.community_members m WHERE m.id = community_members.id)
  AND suspended_at IS NOT DISTINCT FROM (SELECT suspended_at FROM public.community_members m WHERE m.id = community_members.id)
  AND suspended_reason IS NOT DISTINCT FROM (SELECT suspended_reason FROM public.community_members m WHERE m.id = community_members.id)
);

-- 2) Permite que owners de curator_deals leiam seus próprios arquivos no bucket deal-prints
-- Convenção de path: {deal_id}/...
CREATE POLICY "deal-prints owner read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'deal-prints'
  AND EXISTS (
    SELECT 1 FROM public.curator_deals cd
    WHERE cd.id::text = (storage.foldername(name))[1]
      AND cd.user_id = auth.uid()
  )
);