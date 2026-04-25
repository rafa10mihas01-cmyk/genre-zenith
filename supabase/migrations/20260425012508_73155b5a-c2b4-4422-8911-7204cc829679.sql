-- 1) Allowlist de emails permitidos no login público via Spotify
CREATE TABLE IF NOT EXISTS public.spotify_email_allowlist (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL UNIQUE,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS idx_spotify_email_allowlist_email_lower
  ON public.spotify_email_allowlist (lower(email));

ALTER TABLE public.spotify_email_allowlist ENABLE ROW LEVEL SECURITY;

-- Apenas admins podem gerenciar a allowlist
CREATE POLICY admins_select_allowlist ON public.spotify_email_allowlist
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY admins_insert_allowlist ON public.spotify_email_allowlist
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY admins_update_allowlist ON public.spotify_email_allowlist
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admins_delete_allowlist ON public.spotify_email_allowlist
  FOR DELETE TO authenticated USING (public.is_admin());

-- 2) Tornar user_id opcional em spotify_oauth_states (fluxo público não tem usuário ainda)
ALTER TABLE public.spotify_oauth_states ALTER COLUMN user_id DROP NOT NULL;

-- Coluna opcional para distinguir o flow (admin connect vs login público)
ALTER TABLE public.spotify_oauth_states
  ADD COLUMN IF NOT EXISTS flow text NOT NULL DEFAULT 'admin_connect';

-- 3) Seed inicial: adicionar o(s) email(s) de admin existente(s) à allowlist
INSERT INTO public.spotify_email_allowlist (email, note)
SELECT DISTINCT lower(u.email), 'admin inicial (auto-seed)'
FROM auth.users u
JOIN public.user_roles r ON r.user_id = u.id AND r.role = 'admin'::public.app_role
WHERE u.email IS NOT NULL
ON CONFLICT (email) DO NOTHING;