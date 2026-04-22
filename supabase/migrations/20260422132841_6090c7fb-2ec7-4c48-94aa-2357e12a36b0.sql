-- 1) Novos campos em playlist_blueprints
ALTER TABLE public.playlist_blueprints
  ADD COLUMN IF NOT EXISTS performance_source text,
  ADD COLUMN IF NOT EXISTS replication_priority text NOT NULL DEFAULT 'media',
  ADD COLUMN IF NOT EXISTS replication_reason text;

-- Constraints (idempotentes)
DO $$ BEGIN
  ALTER TABLE public.playlist_blueprints
    ADD CONSTRAINT playlist_blueprints_perf_source_chk
    CHECK (performance_source IS NULL OR performance_source IN ('alta','media','baixa'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.playlist_blueprints
    ADD CONSTRAINT playlist_blueprints_repl_priority_chk
    CHECK (replication_priority IN ('alta','media','baixa'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_blueprints_priority
  ON public.playlist_blueprints (genre_id, replication_priority);

-- 2) RPC: dada uma source_result_id (playlist base), retorna a performance_class
--    do template mais recente que originou-se desse spotify_playlist_id.
--    Se não houver template publicado com performance avaliada, retorna NULL.
CREATE OR REPLACE FUNCTION public.get_performance_class_for_source(p_source_result_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH source AS (
    SELECT spotify_playlist_id, genre_id
    FROM public.search_results
    WHERE id = p_source_result_id
  ),
  -- Insights mais recentes do gênero (Claude classifica templates por id)
  latest_insight AS (
    SELECT pi.classificacao, pi.created_at, pi.genre_id
    FROM public.performance_insights pi
    JOIN source s ON s.genre_id = pi.genre_id
    ORDER BY pi.created_at DESC
    LIMIT 1
  )
  SELECT COALESCE(
    -- 1) tenta classe direta de algum template que veio dessa source
    (SELECT t.performance_class
     FROM public.playlist_templates t
     WHERE t.id IN (
       SELECT r.template_id FROM public.replications r
       JOIN source s ON s.spotify_playlist_id IS NOT NULL
       WHERE r.source_result_id = p_source_result_id
     )
     AND t.performance_class IS NOT NULL
     ORDER BY t.performance_evaluated_at DESC NULLS LAST
     LIMIT 1),
    -- 2) fallback: classe predominante do gênero no último insight
    (SELECT CASE
       WHEN (li.classificacao->>'alta')::int >= GREATEST(
              COALESCE((li.classificacao->>'media')::int,0),
              COALESCE((li.classificacao->>'baixa')::int,0)
            ) THEN 'alta'
       WHEN (li.classificacao->>'baixa')::int > COALESCE((li.classificacao->>'media')::int,0)
            THEN 'baixa'
       ELSE 'media'
     END
     FROM latest_insight li)
  );
$$;

-- 3) Helper que mapeia performance_class → priority + reason
CREATE OR REPLACE FUNCTION public.priority_from_performance(p_class text)
RETURNS TABLE(priority text, reason text)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT
    CASE p_class
      WHEN 'alta' THEN 'alta'
      WHEN 'baixa' THEN 'baixa'
      ELSE 'media'
    END AS priority,
    CASE p_class
      WHEN 'alta'  THEN 'padrão vencedor — replicar com prioridade'
      WHEN 'media' THEN 'desempenho médio — replicar com cautela'
      WHEN 'baixa' THEN 'baixo desempenho — marcar para ajuste ou pausa'
      ELSE 'sem histórico de performance — prioridade padrão'
    END AS reason;
$$;