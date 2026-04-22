CREATE OR REPLACE FUNCTION public.priority_from_performance(p_class text)
RETURNS TABLE(priority text, reason text)
LANGUAGE sql
IMMUTABLE
SET search_path = public
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