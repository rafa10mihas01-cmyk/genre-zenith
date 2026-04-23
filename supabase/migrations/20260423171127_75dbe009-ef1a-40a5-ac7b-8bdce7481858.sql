-- 1. Enum de papéis
CREATE TYPE public.app_role AS ENUM ('admin', 'curador');

-- 2. Tabela de papéis (NUNCA na tabela de profiles)
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE(user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. SECURITY DEFINER para evitar recursão de RLS
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin'::public.app_role);
$$;

-- 4. Atualiza has_team_access para exigir admin OU curador
CREATE OR REPLACE FUNCTION public.has_team_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'curador'::public.app_role)
    );
$$;

-- 5. Policies da tabela user_roles
CREATE POLICY "users_view_own_roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "admins_view_all_roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY "admins_insert_roles"
ON public.user_roles FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "admins_update_roles"
ON public.user_roles FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "admins_delete_roles"
ON public.user_roles FOR DELETE
TO authenticated
USING (public.is_admin() AND user_id != auth.uid());

-- 6. Promove o primeiro usuário existente como admin (para não perder acesso)
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
ORDER BY created_at ASC
LIMIT 1
ON CONFLICT (user_id, role) DO NOTHING;