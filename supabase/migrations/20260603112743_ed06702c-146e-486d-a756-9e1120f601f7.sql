
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$fn$;

CREATE OR REPLACE FUNCTION public.has_team_access()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = ANY (ARRAY['admin'::public.app_role, 'operador'::public.app_role])
  );
$fn$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'::public.app_role
  );
$fn$;

DROP TABLE IF EXISTS public._rls_optimization_audit;
CREATE TABLE public._rls_optimization_audit (
  id bigserial PRIMARY KEY,
  tablename text NOT NULL,
  policyname text NOT NULL,
  cmd text NOT NULL,
  before_qual text,
  after_qual text,
  before_check text,
  after_check text,
  changed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public._rls_optimization_audit TO authenticated;
GRANT ALL ON public._rls_optimization_audit TO service_role;
ALTER TABLE public._rls_optimization_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_select_rls_audit"
  ON public._rls_optimization_audit FOR SELECT TO authenticated
  USING ((SELECT public.has_team_access()));

DO $do$
DECLARE
  r record;
  q  text;
  w  text;
  changed boolean;
  ddl text;
  roles_text text;
  total_scanned int := 0;
  total_changed int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename <> '_rls_optimization_audit'
      AND (
        COALESCE(qual,'')       ~ 'has_team_access\(\)|has_role\(|is_admin\(\)' OR
        COALESCE(with_check,'') ~ 'has_team_access\(\)|has_role\(|is_admin\(\)'
      )
    ORDER BY tablename, policyname
  LOOP
    total_scanned := total_scanned + 1;
    q := r.qual;
    w := r.with_check;

    IF q IS NOT NULL THEN
      q := regexp_replace(q, '\(\s*SELECT\s+has_team_access\(\)\s*\)', E'\x01HTA\x02', 'g');
      q := regexp_replace(q, 'has_team_access\(\)', '(SELECT has_team_access())', 'g');
      q := replace(q, E'\x01HTA\x02', '(SELECT has_team_access())');

      q := regexp_replace(q, '\(\s*SELECT\s+is_admin\(\)\s*\)', E'\x01ISA\x02', 'g');
      q := regexp_replace(q, 'is_admin\(\)', '(SELECT is_admin())', 'g');
      q := replace(q, E'\x01ISA\x02', '(SELECT is_admin())');

      q := regexp_replace(q,
            '\(\s*SELECT\s+(has_role\(auth\.uid\(\),\s*''[a-z_]+''::app_role\))\s*\)',
            E'\x01HR\x02\\1\x01END\x02', 'g');
      q := regexp_replace(q,
            '(has_role\(auth\.uid\(\),\s*''[a-z_]+''::app_role\))',
            '(SELECT \1)', 'g');
      q := regexp_replace(q,
            E'\x01HR\x02(has_role\\(auth\\.uid\\(\\),\\s*''[a-z_]+''::app_role\\))\x01END\x02',
            '(SELECT \1)', 'g');
    END IF;

    IF w IS NOT NULL THEN
      w := regexp_replace(w, '\(\s*SELECT\s+has_team_access\(\)\s*\)', E'\x01HTA\x02', 'g');
      w := regexp_replace(w, 'has_team_access\(\)', '(SELECT has_team_access())', 'g');
      w := replace(w, E'\x01HTA\x02', '(SELECT has_team_access())');

      w := regexp_replace(w, '\(\s*SELECT\s+is_admin\(\)\s*\)', E'\x01ISA\x02', 'g');
      w := regexp_replace(w, 'is_admin\(\)', '(SELECT is_admin())', 'g');
      w := replace(w, E'\x01ISA\x02', '(SELECT is_admin())');

      w := regexp_replace(w,
            '\(\s*SELECT\s+(has_role\(auth\.uid\(\),\s*''[a-z_]+''::app_role\))\s*\)',
            E'\x01HR\x02\\1\x01END\x02', 'g');
      w := regexp_replace(w,
            '(has_role\(auth\.uid\(\),\s*''[a-z_]+''::app_role\))',
            '(SELECT \1)', 'g');
      w := regexp_replace(w,
            E'\x01HR\x02(has_role\\(auth\\.uid\\(\\),\\s*''[a-z_]+''::app_role\\))\x01END\x02',
            '(SELECT \1)', 'g');
    END IF;

    changed := (q IS DISTINCT FROM r.qual) OR (w IS DISTINCT FROM r.with_check);

    INSERT INTO public._rls_optimization_audit
      (tablename, policyname, cmd, before_qual, after_qual, before_check, after_check, changed)
    VALUES
      (r.tablename, r.policyname, r.cmd, r.qual, q, r.with_check, w, changed);

    IF NOT changed THEN CONTINUE; END IF;

    SELECT string_agg(quote_ident(role::text), ', ')
      INTO roles_text
      FROM unnest(r.roles) AS role;

    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);

    ddl := format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
      r.policyname, r.schemaname, r.tablename,
      r.permissive, r.cmd, COALESCE(roles_text,'public')
    );
    IF q IS NOT NULL THEN ddl := ddl || ' USING (' || q || ')'; END IF;
    IF w IS NOT NULL THEN ddl := ddl || ' WITH CHECK (' || w || ')'; END IF;

    EXECUTE ddl;
    total_changed := total_changed + 1;
  END LOOP;

  RAISE NOTICE 'RLS_OPTIMIZATION: scanned=% changed=%', total_scanned, total_changed;
END;
$do$;
