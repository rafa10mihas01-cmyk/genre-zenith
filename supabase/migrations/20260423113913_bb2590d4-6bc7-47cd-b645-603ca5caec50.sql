-- Bucket playlist-covers permanece público, mas removemos a policy ampla
-- de SELECT em storage.objects. URLs públicas do Supabase Storage continuam
-- funcionando via signed/public URL direto sem precisar de policy.
DROP POLICY IF EXISTS "Public read playlist-covers" ON storage.objects;