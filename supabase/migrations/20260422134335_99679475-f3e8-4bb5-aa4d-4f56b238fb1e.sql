
CREATE TABLE IF NOT EXISTS public.replication_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id uuid,
  scope text NOT NULL DEFAULT 'genre',
  rule_type text NOT NULL,
  target text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority text NOT NULL DEFAULT 'media',
  confidence text NOT NULL DEFAULT 'media',
  evidence text,
  source_insight_id uuid,
  generated_by_model text,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_replication_rules_genre_active
  ON public.replication_rules(genre_id, active);
CREATE INDEX IF NOT EXISTS idx_replication_rules_type
  ON public.replication_rules(rule_type);

ALTER TABLE public.replication_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_replication_rules" ON public.replication_rules
  FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_replication_rules" ON public.replication_rules
  FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_replication_rules" ON public.replication_rules
  FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_replication_rules" ON public.replication_rules
  FOR DELETE TO authenticated USING (public.has_team_access());

-- Touch updated_at
DROP TRIGGER IF EXISTS trg_replication_rules_touch ON public.replication_rules;
CREATE TRIGGER trg_replication_rules_touch
BEFORE UPDATE ON public.replication_rules
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RPC: pega regras ativas pra um gênero (inclui regras globais)
CREATE OR REPLACE FUNCTION public.get_active_replication_rules(p_genre_id uuid)
RETURNS TABLE (
  id uuid,
  scope text,
  rule_type text,
  target text,
  value jsonb,
  condition jsonb,
  priority text,
  confidence text,
  evidence text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, scope, rule_type, target, value, condition, priority, confidence, evidence
  FROM public.replication_rules
  WHERE active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND (genre_id = p_genre_id OR genre_id IS NULL)
  ORDER BY
    CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
    CASE confidence WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
    created_at DESC
  LIMIT 50;
$$;
