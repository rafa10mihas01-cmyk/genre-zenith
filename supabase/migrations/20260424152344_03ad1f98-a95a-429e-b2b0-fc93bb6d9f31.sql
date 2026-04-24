-- RPC para edge function ler CRON_SECRET do vault de forma segura.
-- Apenas service_role pode chamar (RLS via function-level security definer).
CREATE OR REPLACE FUNCTION public.get_cron_secret()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT decrypted_secret 
  FROM vault.decrypted_secrets 
  WHERE name = 'CRON_SECRET' 
  LIMIT 1;
$$;

-- Restringe execução: só service_role
REVOKE ALL ON FUNCTION public.get_cron_secret() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cron_secret() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_secret() TO service_role;