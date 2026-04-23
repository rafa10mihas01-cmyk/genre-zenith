-- Adicionar colunas de scoring e tier em playlist_templates
ALTER TABLE public.playlist_templates
  ADD COLUMN IF NOT EXISTS final_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quality_tier text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_cover_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scored_at timestamp with time zone;

-- Validação de tier via trigger (evitamos CHECK constraint pra permitir evolução futura)
CREATE OR REPLACE FUNCTION public.validate_template_tier()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.quality_tier NOT IN ('hot', 'medium', 'weak', 'archived') THEN
    RAISE EXCEPTION 'quality_tier inválido: %. Use hot, medium, weak ou archived.', NEW.quality_tier;
  END IF;
  IF NEW.final_score < 0 OR NEW.final_score > 100 THEN
    RAISE EXCEPTION 'final_score deve estar entre 0 e 100. Recebido: %', NEW.final_score;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_template_tier ON public.playlist_templates;
CREATE TRIGGER trg_validate_template_tier
  BEFORE INSERT OR UPDATE OF quality_tier, final_score
  ON public.playlist_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_template_tier();

-- Índice para a tela de Cockpit (lista por tier + score desc)
CREATE INDEX IF NOT EXISTS idx_playlist_templates_tier_score
  ON public.playlist_templates (quality_tier, final_score DESC, created_at DESC)
  WHERE status = 'pending';

-- Índice auxiliar para ranqueamento global
CREATE INDEX IF NOT EXISTS idx_playlist_templates_final_score
  ON public.playlist_templates (final_score DESC)
  WHERE status IN ('pending', 'approved');