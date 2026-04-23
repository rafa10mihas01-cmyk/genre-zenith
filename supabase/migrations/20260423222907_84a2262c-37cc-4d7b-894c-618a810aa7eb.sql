-- Defense-in-depth trigger: garante que apenas admins (ou service role) possam
-- alterar a tabela user_roles, independente das policies de RLS.
CREATE OR REPLACE FUNCTION public.enforce_admin_role_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role (edge functions com SUPABASE_SERVICE_ROLE_KEY) sempre passa.
  -- auth.uid() é NULL quando a chamada vem do service role / contexto sem JWT.
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Usuários autenticados precisam ser admin para mexer em user_roles.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem gerenciar papéis de usuário'
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS enforce_admin_role_changes_trg ON public.user_roles;

CREATE TRIGGER enforce_admin_role_changes_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_admin_role_changes();